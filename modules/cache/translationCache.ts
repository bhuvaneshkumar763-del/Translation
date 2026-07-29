/**
 * The real IndexedDB-backed disk cache, replacing the Phase 1 in-memory
 * placeholder. Ported from background/translationCache.js, including the
 * cache-creation race fix and orphan-cleanup work already hardened on this
 * repo (see the bug-fix-phase commits) and the size-budget eviction added on
 * top of upstream. One IndexedDB database per (service, sourceLanguage,
 * targetLanguage) triple, keyed by a SHA-1 hash of the original text, plus a
 * `cacheList` database recording which per-triple databases exist (needed so
 * calculateSize()/enforceBudget()/deleteAll() can enumerate them without
 * IndexedDB's `indexedDB.databases()` — not implemented everywhere).
 */

export interface CacheEntry {
  originalText: string;
  translatedText: string;
  detectedLanguage: string;
  key: string;
  lastUsed: number;
}

const CACHE_STORAGE_NAME = 'cache';
const CACHE_LIST_STORAGE_NAME = 'cache_list';
const SIX_HOURS = 6 * 60 * 60 * 1000;

async function stringToSHA1String(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getDataBaseName(translationService: string, sourceLanguage: string, targetLanguage: string): string {
  return `${translationService}@${sourceLanguage}.${targetLanguage}`;
}

function openIndexeddb(name: string, version: number, objectStorageNames: string[]): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    request.onsuccess = () => resolve(request.result);
    const onFail = (event: Event) => {
      console.error('Error opening the database, switching to non-database mode', event);
      reject(event);
    };
    request.onerror = onFail;
    request.onblocked = onFail;
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storageName of objectStorageNames) {
        db.createObjectStore(storageName, { keyPath: 'key' });
      }
    };
  });
}

function deleteDatabase(dbName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(dbName);
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
  });
}

async function getTableSize(db: IDBDatabase, storageName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const cursorRequest = db.transaction([storageName]).objectStore(storageName).openCursor();
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        size += JSON.stringify(cursor.value).length;
        cursor.continue();
      } else {
        resolve(size);
      }
    };
    cursorRequest.onerror = (err) => reject(err);
  });
}

async function getDatabaseSize(dbName: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    const onFail = (event: Event) => {
      console.error(event);
      reject(event);
    };
    request.onerror = onFail;
    request.onblocked = onFail;
    request.onsuccess = async () => {
      try {
        const db = request.result;
        const tableNames = [...db.objectStoreNames];
        const sizes = await Promise.all(tableNames.map((name) => getTableSize(db, name)));
        resolve(sizes.reduce((acc, val) => acc + val, 0));
      } catch (e) {
        reject(e);
      } finally {
        request.result.close();
      }
    };
  });
}

function humanReadableSize(bytes: number): string {
  const thresh = 1024;
  if (Math.abs(bytes) < thresh) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  let u = -1;
  let value = bytes;
  do {
    value /= thresh;
    ++u;
  } while (Math.abs(value) >= thresh && u < units.length - 1);
  return `${value.toFixed(1)} ${units[u]}`;
}

class Cache {
  private db: IDBDatabase | null = null;
  promiseStartingCache: Promise<boolean> | null = null;

  constructor(
    private translationService: string,
    private sourceLanguage: string,
    private targetLanguage: string,
  ) {}

  async start(): Promise<boolean> {
    if (this.promiseStartingCache) return this.promiseStartingCache;
    this.promiseStartingCache = (async () => {
      try {
        this.db = await openIndexeddb(this.dbName(), 1, [CACHE_STORAGE_NAME]);
        return true;
      } catch (e) {
        console.error(e);
        await deleteDatabase(this.dbName());
        return false;
      }
    })();
    return this.promiseStartingCache;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private dbName(): string {
    return getDataBaseName(this.translationService, this.sourceLanguage, this.targetLanguage);
  }

  private async queryInDB(hash: string): Promise<CacheEntry | undefined> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('cache db not open'));
      const request = this.db.transaction([CACHE_STORAGE_NAME], 'readonly').objectStore(CACHE_STORAGE_NAME).get(hash);
      request.onsuccess = () => resolve(request.result);
      request.onerror = (event) => reject(event);
    });
  }

  async query(originalText: string): Promise<CacheEntry | undefined> {
    const hash = await stringToSHA1String(originalText);
    let translation: CacheEntry | undefined;
    try {
      translation = await this.queryInDB(hash);
    } catch {
      return undefined;
    }
    if (translation) {
      // Approximate LRU: refresh lastUsed on read, at most once every 6h per
      // entry, so reads don't amplify into writes. Entries that keep getting
      // read survive size-budget eviction; stale ones age out.
      if (!translation.lastUsed || Date.now() - translation.lastUsed > SIX_HOURS) {
        translation.lastUsed = Date.now();
        this.addInDb(translation).catch(() => {});
      }
    }
    return translation;
  }

  private async addInDb(data: CacheEntry): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.db) return resolve(false);
      const request = this.db.transaction([CACHE_STORAGE_NAME], 'readwrite').objectStore(CACHE_STORAGE_NAME).put(data);
      request.onsuccess = () => resolve(true);
      request.onerror = (event) => {
        console.error(event);
        resolve(false);
      };
    });
  }

  async add(originalText: string, translatedText: string, detectedLanguage = 'und'): Promise<boolean> {
    const hash = await stringToSHA1String(originalText);
    return this.addInDb({ originalText, translatedText, detectedLanguage, key: hash, lastUsed: Date.now() });
  }

  /** Evicts the oldest entries (by lastUsed) until at least bytesToFree bytes have been removed. Returns bytes freed. */
  static async evictOldestFromDb(dbName: string, bytesToFree: number): Promise<number> {
    if (!(bytesToFree > 0)) return 0;
    let db: IDBDatabase;
    try {
      db = await openIndexeddb(dbName, 1, [CACHE_STORAGE_NAME]);
    } catch {
      return 0;
    }
    try {
      const entries = await new Promise<Array<{ key: IDBValidKey; lastUsed: number; size: number }>>(
        (resolve, reject) => {
          const out: Array<{ key: IDBValidKey; lastUsed: number; size: number }> = [];
          const req = db.transaction([CACHE_STORAGE_NAME], 'readonly').objectStore(CACHE_STORAGE_NAME).openCursor();
          req.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (cursor) {
              const v = (cursor.value ?? {}) as Partial<CacheEntry>;
              let size = 0;
              try {
                size = JSON.stringify(v).length;
              } catch {
                // ignore
              }
              out.push({ key: cursor.key, lastUsed: v.lastUsed ?? 0, size });
              cursor.continue();
            } else {
              resolve(out);
            }
          };
          req.onerror = () => reject(req.error);
        },
      );

      entries.sort((a, b) => a.lastUsed - b.lastUsed); // oldest first

      let freed = 0;
      const toDelete: IDBValidKey[] = [];
      for (const e of entries) {
        if (freed >= bytesToFree) break;
        toDelete.push(e.key);
        freed += e.size;
      }
      if (toDelete.length) {
        await new Promise<void>((resolve) => {
          const tx = db.transaction([CACHE_STORAGE_NAME], 'readwrite');
          const store = tx.objectStore(CACHE_STORAGE_NAME);
          for (const k of toDelete) store.delete(k);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        });
      }
      return freed;
    } catch (e) {
      console.debug('cache eviction failed for', dbName, e);
      return 0;
    } finally {
      db.close();
    }
  }
}

class CacheListManager {
  private list = new Map<string, Cache>();
  private dbCacheList: IDBDatabase | null = null;

  constructor() {
    this.openCacheList();
  }

  private openCacheList(): void {
    const request = indexedDB.open('cacheList', 1);

    request.onsuccess = () => {
      this.dbCacheList = request.result;

      // If any translation cache was created while waiting for the cacheList
      // to be created, add all these entries to the cacheList, but only once
      // each one has actually finished starting (same reasoning as
      // #createCache — persisting a name before its object store exists lets
      // a concurrent size-budget sweep silently create an empty db under
      // that name, which then permanently blocks the real store from ever
      // being made).
      this.list.forEach((cache, key) => {
        Promise.resolve(cache.promiseStartingCache).then((started) => {
          if (started) this.addCacheList(key);
        });
      });
    };

    const onFail = (event: Event) => {
      console.error('Error opening the database', event);
      this.dbCacheList = null;
    };
    request.onerror = onFail;
    request.onblocked = onFail;

    request.onupgradeneeded = () => {
      request.result.createObjectStore(CACHE_LIST_STORAGE_NAME, { keyPath: 'dbName' });
    };
  }

  private addCacheList(dbName: string): void {
    if (!this.dbCacheList) return;
    const request = this.dbCacheList
      .transaction([CACHE_LIST_STORAGE_NAME], 'readwrite')
      .objectStore(CACHE_LIST_STORAGE_NAME)
      .put({ dbName });
    request.onerror = (event) => console.error(event);
  }

  /**
   * Create and start a translation cache, then add it to cacheList once it
   * has actually finished starting. The dbName is registered in the
   * in-memory `list` immediately (so a concurrent getCache() call for the
   * same name reuses this Cache instance instead of racing to create a
   * duplicate one), but is only persisted to the cache_list database after
   * cache.start() succeeds — see the class-level doc comment for why.
   */
  private async createCache(
    translationService: string,
    sourceLanguage: string,
    targetLanguage: string,
  ): Promise<Cache> {
    const cache = new Cache(translationService, sourceLanguage, targetLanguage);
    this.list.set(getDataBaseName(translationService, sourceLanguage, targetLanguage), cache);
    let started = false;
    try {
      started = await cache.start();
    } catch (e) {
      console.error(e);
    }
    if (started) {
      try {
        this.addCacheList(getDataBaseName(translationService, sourceLanguage, targetLanguage));
      } catch {
        // ignore
      }
    }
    return cache;
  }

  async getCache(translationService: string, sourceLanguage: string, targetLanguage: string): Promise<Cache> {
    const dbName = getDataBaseName(translationService, sourceLanguage, targetLanguage);
    const cache = this.list.get(dbName);
    if (cache) {
      await cache.promiseStartingCache;
      return cache;
    }
    return this.createCache(translationService, sourceLanguage, targetLanguage);
  }

  private async getAllDBNames(): Promise<string[]> {
    if (!this.dbCacheList) return [];
    return new Promise((resolve) => {
      const request = this.dbCacheList!.transaction([CACHE_LIST_STORAGE_NAME], 'readonly')
        .objectStore(CACHE_LIST_STORAGE_NAME)
        .getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = (event) => {
        console.error(event);
        resolve([]);
      };
    });
  }

  async deleteAll(): Promise<boolean> {
    try {
      const promises: Array<Promise<unknown>> = [];
      this.list.forEach((cache, key) => {
        cache.close();
        promises.push(deleteDatabase(key));
      });
      this.list.clear();
      const dbnames = await this.getAllDBNames();
      dbnames.forEach((dbName) => promises.push(deleteDatabase(dbName)));
      await Promise.all(promises);

      // Also clear the persisted cache_list records themselves — otherwise
      // these now-deleted names stay listed forever, and a later size-budget
      // sweep would silently recreate an empty database under each stale
      // name just by checking its size.
      if (this.dbCacheList) {
        await new Promise<void>((resolve) => {
          const req = this.dbCacheList!.transaction([CACHE_LIST_STORAGE_NAME], 'readwrite')
            .objectStore(CACHE_LIST_STORAGE_NAME)
            .clear();
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        });
      }
      return true;
    } catch (e) {
      console.error(e);
      return false;
    }
  }

  async calculateSize(): Promise<string> {
    try {
      const dbnames = await this.getAllDBNames();
      const results = await Promise.all(dbnames.map((dbName) => getDatabaseSize(dbName)));
      return humanReadableSize(results.reduce((total, size) => total + size, 0));
    } catch (e) {
      console.error(e);
      return humanReadableSize(0);
    }
  }

  /**
   * Keeps total cache size under a budget. When the sum across all cache DBs
   * exceeds `highWater`, evicts oldest entries (largest DBs first) until
   * back under `lowWater`. Cheap to call when already under budget (just a
   * sum).
   */
  async enforceBudget(highWater: number, lowWater: number): Promise<void> {
    try {
      const dbnames = await this.getAllDBNames();
      if (!dbnames.length) return;
      const sized: Array<{ dbName: string; size: number }> = [];
      let total = 0;
      for (const dbName of dbnames) {
        let size = 0;
        try {
          size = await getDatabaseSize(dbName);
        } catch {
          // ignore
        }
        sized.push({ dbName, size });
        total += size;
      }
      if (total <= highWater) return;

      let toFree = total - lowWater;
      sized.sort((a, b) => b.size - a.size); // largest DB first
      for (const { dbName } of sized) {
        if (toFree <= 0) break;
        const freed = await Cache.evictOldestFromDb(dbName, toFree);
        toFree -= freed;
      }
      console.info('Translation cache trimmed:', humanReadableSize(total), '->', humanReadableSize(lowWater));
    } catch (e) {
      console.debug('enforceBudget failed', e);
    }
  }
}

const cacheList = new CacheListManager();

// The translation cache otherwise grows without bound (one record per unique
// paragraph, forever), eventually hitting the browser storage quota where
// writes start failing silently. Keep it bounded: trim oldest entries back
// under LOW_WATER whenever it crosses HIGH_WATER. Checked off the write path
// (every Nth add, debounced) plus once shortly after startup, so it never
// adds latency to a translation.
const CACHE_HIGH_WATER = 80 * 1024 * 1024; // 80 MB
const CACHE_LOW_WATER = 60 * 1024 * 1024; // trim down to 60 MB
const CACHE_CHECK_EVERY = 400; // adds between checks
let addsSinceCheck = 0;
let enforcingBudget = false;
function maybeEnforceCacheBudget(force: boolean): void {
  if (enforcingBudget) return;
  if (!force && ++addsSinceCheck < CACHE_CHECK_EVERY) return;
  addsSinceCheck = 0;
  enforcingBudget = true;
  Promise.resolve()
    .then(() => cacheList.enforceBudget(CACHE_HIGH_WATER, CACHE_LOW_WATER))
    .catch((e) => console.debug(e))
    .finally(() => {
      enforcingBudget = false;
    });
}
// one sweep ~15s after the service worker wakes (catches already-bloated DBs)
setTimeout(() => maybeEnforceCacheBudget(true), 15000);

export const translationCache = {
  async get(
    service: string,
    sourceLanguage: string,
    targetLanguage: string,
    text: string,
  ): Promise<CacheEntry | undefined> {
    try {
      const cache = await cacheList.getCache(service, sourceLanguage, targetLanguage);
      return await cache.query(text);
    } catch (e) {
      console.error(e);
      return undefined;
    }
  },

  async set(
    service: string,
    sourceLanguage: string,
    targetLanguage: string,
    text: string,
    translatedText: string,
    detectedLanguage: string,
  ): Promise<void> {
    try {
      const cache = await cacheList.getCache(service, sourceLanguage, targetLanguage);
      await cache.add(text, translatedText, detectedLanguage);
      maybeEnforceCacheBudget(false);
    } catch (e) {
      console.error(e);
    }
  },

  async calculateSize(): Promise<string> {
    return cacheList.calculateSize();
  },

  async deleteAll(reload = false): Promise<void> {
    try {
      // Delete the pre-fork, per-service legacy caches too, if they still exist.
      await Promise.allSettled([
        deleteDatabase('googleCache'),
        deleteDatabase('yandexCache'),
        deleteDatabase('bingCache'),
      ]);
      await cacheList.deleteAll();
    } finally {
      if (reload) browser.runtime.reload();
    }
  },
};
