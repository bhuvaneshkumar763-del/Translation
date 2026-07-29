"use strict";

const translationCache = (function () {
  const translationCache = {};

  /**
   * @typedef {Object} CacheEntry
   * @property {String} originalText
   * @property {String} translatedText
   * @property {String} detectedLanguage
   * @property {String} key
   */

  class Utils {
    /**
     * Returns the size of a ObjectStorage
     * @param {IDBDatabase} db
     * @param {string} storageName
     * @returns {Promise<number>} Promise\<size\>
     */
    static async getTableSize(db, storageName) {
      return await new Promise((resolve, reject) => {
        if (db == null) return reject();
        let size = 0;
        const transaction = db
          .transaction([storageName])
          .objectStore(storageName)
          .openCursor();

        transaction.onsuccess = (event) => {
          const cursor = transaction.result;
          if (cursor) {
            const storedObject = cursor.value;
            const json = JSON.stringify(storedObject);
            size += json.length;
            cursor.continue();
          } else {
            resolve(size);
          }
        };
        transaction.onerror = (err) =>
          reject("error in " + storageName + ": " + err);
      });
    }

    /**
     * Returns the size of a database
     * @param {string} dbName
     * @returns {Promise<number>} Promise\<size\>
     */
    static async getDatabaseSize(dbName) {
      return await new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onerror = request.onblocked = (event) => {
          console.error(event);
          reject();
        };
        request.onsuccess = (event) => {
          try {
            const db = request.result;
            const tableNames = [...db.objectStoreNames];
            ((tableNames, db) => {
              const tableSizeGetters = tableNames.reduce((acc, tableName) => {
                acc.push(Utils.getTableSize(db, tableName));
                return acc;
              }, []);

              Promise.all(tableSizeGetters)
                .then((sizes) => {
                  const total = sizes.reduce((acc, val) => acc + val, 0);
                  resolve(total);
                })
                .catch((e) => {
                  console.error(e);
                  reject();
                });
            })(tableNames, db);
          } finally {
            request.result.close();
          }
        };
      });
    }

    /**
     * Converts a size in bytes to a human-readable string.
     * @example
     * humanReadableSize(1024)
     * // returns "1.0KB"
     * @param {number} bytes
     * @returns {string} sizeString
     */
    static humanReadableSize(bytes) {
      const thresh = 1024;
      if (Math.abs(bytes) < thresh) {
        return bytes + " B";
      }
      const units = ["KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];
      let u = -1;
      do {
        bytes /= thresh;
        ++u;
      } while (Math.abs(bytes) >= thresh && u < units.length - 1);
      return bytes.toFixed(1) + " " + units[u];
    }

    /**
     * Returns a Promise that resolves to a sha1 string of the given text.
     * @example
     * await stringToSHA1String("Hello World!")
     * // returns "2ef7bde608ce5404e97d5f042f95f89f1c232871"
     * @param {string} message text
     * @returns {Promise<string>} Promise\<sha1String\>
     */
    static async stringToSHA1String(message) {
      const msgUint8 = new TextEncoder().encode(message); // encode as (utf-8) Uint8Array
      const hashBuffer = await crypto.subtle.digest("SHA-1", msgUint8); // hash the message
      const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join(""); // convert bytes to hex string
    }
  }

  class Cache {
    /**
     * Base class to create a translation cache for different services.
     * @param {string} translationService
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     */
    constructor(translationService, sourceLanguage, targetLanguage) {
      /** @type {string} */
      this.translationService = translationService;
      /** @type {string} */
      this.sourceLanguage = sourceLanguage;
      /** @type {string} */
      this.targetLanguage = targetLanguage;
      /** @type {Map<string, CacheEntry>} */
      this.cache = new Map();
      /** @type {Promise<boolean>} */
      this.promiseStartingCache = null;
    }

    /**
     * Start the translation cache
     * @returns {Promise<boolean>}
     */
    async start() {
      if (this.promiseStartingCache) return await this.promiseStartingCache;
      this.promiseStartingCache = new Promise((resolve) => {
        Cache.openDataBaseCache(
          this.translationService,
          this.sourceLanguage,
          this.targetLanguage
        )
          .then((db) => {
            this.db = db;
            resolve(true);
          })
          .catch((e) => {
            console.error(e);
            Cache.deleteDatabase(
              this.translationService,
              this.sourceLanguage,
              this.targetLanguage
            );
            resolve(false);
          });
      });
      return await this.promiseStartingCache;
    }

    /**
     * Closes the database.
     */
    close() {
      if (this.db) this.db.close();
      this.db = null;
    }

    /**
     * Queries an entry in the translation cache, through the hash of the source text.
     * @param {string} origTextHash
     * @returns {Promise<CacheEntry>}
     */
    async #queryInDB(origTextHash) {
      return await new Promise((resolve, reject) => {
        if (!this.db) return reject();

        const storageName = Cache.getCacheStorageName();
        const objectStore = this.db
          .transaction([storageName], "readonly")
          .objectStore(storageName);
        const request = objectStore.get(origTextHash);

        request.onsuccess = (event) => {
          const result = request.result;
          resolve(result);
        };

        request.onerror = (event) => {
          console.error(event);
          reject();
        };
      });
    }

    /**
     * Query translation cache data
     * @param {string} originalText
     * @returns {Promise<CacheEntry>}
     */
    async query(originalText) {
      const hash = await Utils.stringToSHA1String(originalText);

      let translation = this.cache.get(hash);
      if (translation) return translation;

      translation = await this.#queryInDB(hash);
      if (translation) {
        this.cache.set(hash, translation);
        // Approximate LRU: refresh lastUsed when an entry is re-read, but at
        // most once every 6h per entry so reads don't amplify into writes.
        // Entries that keep getting read survive size-budget eviction; stale
        // ones age out. Fire-and-forget — never blocks the lookup.
        const sixHours = 6 * 60 * 60 * 1000;
        if (!translation.lastUsed || Date.now() - translation.lastUsed > sixHours) {
          translation.lastUsed = Date.now();
          this.#addInDb(translation).catch(() => {});
        }
      }

      return translation;
    }

    /**
     * Store the data in the database
     * @param {CacheEntry} data
     * @returns {Promise<boolean>}
     */
    async #addInDb(data) {
      return await new Promise((resolve) => {
        if (!this.db) return resolve(false);

        const storageName = Cache.getCacheStorageName();
        const objectStore = this.db
          .transaction([storageName], "readwrite")
          .objectStore(storageName);
        const request = objectStore.put(data);

        request.onsuccess = (event) => {
          resolve(true);
        };

        request.onerror = (event) => {
          console.error(event);
          resolve(false);
        };
      });
    }

    /**
     * Add to translation cache
     * @param {string} originalText
     * @param {string} translatedText
     * @param {string} detectedLanguage
     * @returns {Promise<boolean>}
     */
    async add(originalText, translatedText, detectedLanguage = "und") {
      const hash = await Utils.stringToSHA1String(originalText);
      return await this.#addInDb({
        originalText,
        translatedText,
        detectedLanguage,
        key: hash,
        lastUsed: Date.now(),
      });
    }

    /**
     * Returns the name of the database using the given data.
     * @example
     * getDataBaseName("google", "de", "en")
     * // returns "google@de.en"
     * @param {string} translationService
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @returns {string} databaseName
     */
    static getDataBaseName(translationService, sourceLanguage, targetLanguage) {
      return `${translationService}@${sourceLanguage}.${targetLanguage}`;
    }

    /**
     * Returns the storageName
     * @example
     * getCacheStorageName()
     * // returns "cache"
     * @returns {string} storageName
     */
    static getCacheStorageName() {
      return "cache";
    }

    /**
     * Start/create a database with the given data.
     * @param {string} name
     * @param {number} version
     * @param {string[]} objectStorageNames
     * @returns {Promise<IDBDatabase>}
     */
    static async openIndexeddb(name, version, objectStorageNames) {
      return await new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);

        request.onsuccess = (event) => {
          console.info(request.result);
          resolve(request.result);
        };

        request.onerror = request.onblocked = (event) => {
          console.error(
            "Error opening the database, switching to non-database mode",
            event
          );
          reject();
        };

        request.onupgradeneeded = (event) => {
          const db = request.result;

          for (const storageName of objectStorageNames) {
            db.createObjectStore(storageName, {
              keyPath: "key",
            });
          }
        };
      });
    }

    /**
     * Start/create a database for the translation cache with the given data.
     * @param {string} translationService
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @returns {Promise<IDBDatabase>}
     */
    static async openDataBaseCache(
      translationService,
      sourceLanguage,
      targetLanguage
    ) {
      const dbName = Cache.getDataBaseName(
        translationService,
        sourceLanguage,
        targetLanguage
      );
      const storageName = Cache.getCacheStorageName();
      const db = await Cache.openIndexeddb(dbName, 1, [storageName]);
      return db;
    }

    /**
     * Evicts the oldest entries (by lastUsed) from a cache database until at
     * least `bytesToFree` bytes have been removed. Legacy records with no
     * lastUsed are treated as oldest and go first. Returns bytes freed.
     * @param {string} dbName
     * @param {number} bytesToFree
     * @returns {Promise<number>}
     */
    static async evictOldestFromDb(dbName, bytesToFree) {
      if (!(bytesToFree > 0)) return 0;
      let db;
      try {
        db = await Cache.openIndexeddb(dbName, 1, [Cache.getCacheStorageName()]);
      } catch (e) {
        return 0;
      }
      const storageName = Cache.getCacheStorageName();
      try {
        // Pass 1: collect {key, lastUsed, size} for every record (we keep only
        // the small triples, not the text, so peak memory stays modest).
        const entries = await new Promise((resolve, reject) => {
          const out = [];
          const req = db
            .transaction([storageName], "readonly")
            .objectStore(storageName)
            .openCursor();
          req.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              const v = cursor.value || {};
              let size = 0;
              try {
                size = JSON.stringify(v).length;
              } catch (e) {}
              out.push({ key: cursor.key, lastUsed: v.lastUsed || 0, size });
              cursor.continue();
            } else {
              resolve(out);
            }
          };
          req.onerror = () => reject(req.error);
        });

        entries.sort((a, b) => a.lastUsed - b.lastUsed); // oldest first

        // Pass 2: delete oldest until we've freed enough.
        let freed = 0;
        const toDelete = [];
        for (const e of entries) {
          if (freed >= bytesToFree) break;
          toDelete.push(e.key);
          freed += e.size;
        }
        if (toDelete.length) {
          await new Promise((resolve) => {
            const tx = db.transaction([storageName], "readwrite");
            const store = tx.objectStore(storageName);
            for (const key of toDelete) store.delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
            tx.onabort = () => resolve();
          });
        }
        return freed;
      } catch (e) {
        console.debug("cache eviction failed for", dbName, e);
        return 0;
      } finally {
        try {
          db.close();
        } catch (e) {}
      }
    }

    /**
     * Delete a database.
     * @param {string} translationService
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @returns {Promise<boolean>}
     */
    static async deleteDatabase(
      translationService,
      sourceLanguage,
      targetLanguage
    ) {
      return await new Promise((resolve) => {
        try {
          const dbName = Cache.getDataBaseName(
            translationService,
            sourceLanguage,
            targetLanguage
          );
          const request = indexedDB.deleteDatabase(dbName);

          request.onsuccess = (event) => {
            resolve(true);
          };

          request.onerror = (event) => {
            console.error(event);
            resolve(false);
          };
        } catch (e) {
          console.error(e);
          resolve(false);
        }
      });
    }
  }

  class CacheList {
    /**
     * Defines a translation cache manager.
     */
    constructor() {
      /** @type {Map<string, Cache>} */
      this.list = new Map();
      try {
        this.#openCacheList();
      } catch (e) {
        console.error(e);
      }
    }

    /**
     * Starts the connection to the database cacheList.
     */
    #openCacheList() {
      const request = indexedDB.open("cacheList", 1);

      request.onsuccess = (event) => {
        this.dbCacheList = request.result;

        // If any translation cache was created while waiting for the cacheList to be created.
        // Then add all these entries to the cacheList.
        this.list.forEach((cache, key) => {
          this.#addCacheList(key);
        });
      };

      request.onerror = request.onblocked = (event) => {
        console.error("Error opening the database", event);
        this.dbCacheList = null;
      };

      request.onupgradeneeded = (event) => {
        const db = request.result;

        db.createObjectStore("cache_list", {
          keyPath: "dbName",
        });
      };
    }

    /**
     * Stores a new translation cache name to cacheList.
     * @param {string} dbName
     */
    #addCacheList(dbName) {
      if (!this.dbCacheList) return;

      const storageName = "cache_list";
      const objectStore = this.dbCacheList
        .transaction([storageName], "readwrite")
        .objectStore(storageName);
      const request = objectStore.put({ dbName });

      request.onsuccess = (event) => {};

      request.onerror = (event) => {
        console.error(event);
      };
    }

    /**
     * Create and start a translation cache then add to cacheList.
     * @param {string} translationService
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @returns {Promise<Cache>}
     */
    async #createCache(translationService, sourceLanguage, targetLanguage) {
      const cache = new Cache(
        translationService,
        sourceLanguage,
        targetLanguage
      );
      this.#addCache(translationService, sourceLanguage, targetLanguage, cache);
      try {
        await cache.start();
      } catch (e) {
        console.error(e);
      }
      return cache;
    }

    /**
     * Get a translation cache from the given data.
     * If the translation cache does not exist, create a new one.
     * @param {string} translationService
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @returns {Promise<Cache>}
     */
    async getCache(translationService, sourceLanguage, targetLanguage) {
      const dbName = Cache.getDataBaseName(
        translationService,
        sourceLanguage,
        targetLanguage
      );
      const cache = this.list.get(dbName);
      if (cache) {
        await cache.promiseStartingCache;
        return cache;
      } else {
        return await this.#createCache(
          translationService,
          sourceLanguage,
          targetLanguage
        );
      }
    }

    /**
     * Adds a new translation cache name to the "list" and if possible stores it in the cacheList database.
     * @param {string} translationService
     * @param {string} sourceLanguage
     * @param {string} targetLanguage
     * @param {Cache} cache
     */
    #addCache(translationService, sourceLanguage, targetLanguage, cache) {
      const dbName = Cache.getDataBaseName(
        translationService,
        sourceLanguage,
        targetLanguage
      );
      this.list.set(dbName, cache);
      try {
        this.#addCacheList(dbName);
      } catch {}
    }

    /**
     * Get the name of all translation caches.
     * @example
     * #getAllDBNames()
     * // returns ["google@de.en", "google@zh-CN.es", "yandex@ru.pt"]
     * @returns {Promise<string[]>}
     */
    async #getAllDBNames() {
      if (!this.dbCacheList) return [];
      return await new Promise((resolve) => {
        const storageName = "cache_list";
        const objectStore = this.dbCacheList
          .transaction([storageName], "readonly")
          .objectStore(storageName);
        const request = objectStore.getAllKeys();

        request.onsuccess = (event) => {
          // TODO this cast is realy necessary?
          //cast
          resolve(/** @type {string[]} */ (request.result));
        };

        request.onerror = (event) => {
          console.error(event);
          resolve([]);
        };
      });
    }

    /**
     * Delete all translation caches.
     * And clear the cache list.
     * @returns {Promise<boolean>}
     */
    async deleteAll() {
      try {
        /** @type {Array<Promise>} */
        const promises = [];
        this.list.forEach((cache, key) => {
          if (cache) cache.close();
          promises.push(CacheList.deleteDatabase(key));
        });
        this.list.clear();
        const dbnames = await this.#getAllDBNames();
        dbnames.forEach((dbName) => {
          promises.push(CacheList.deleteDatabase(dbName));
        });
        await Promise.all(promises);
        return true;
      } catch (e) {
        console.error(e);
        return false;
      }
    }

    /**
     * Delete a database by its name.
     * @returns {Promise<boolean>}
     */
    static async deleteDatabase(dbName) {
      return await new Promise((resolve) => {
        const DBDeleteRequest = indexedDB.deleteDatabase(dbName);

        DBDeleteRequest.onsuccess = () => {
          console.info("Database deleted successfully");
          resolve(true);
        };

        DBDeleteRequest.onerror = () => {
          console.warn("Error deleting database.");
          resolve(false);
        };
      });
    }

    /**
     * Gets the sum of the size of all translation caches.
     * @example
     * await calculateSize()
     * // returns "1.0MB"
     * @returns {Promise<string>}
     */
    async calculateSize() {
      try {
        /** @type {Array<Promise>} */
        const promises = [];
        const dbnames = await this.#getAllDBNames();
        dbnames.forEach((dbName) => {
          promises.push(Utils.getDatabaseSize(dbName));
        });
        const results = await Promise.all(promises);
        return Utils.humanReadableSize(
          results.reduce((total, size) => total + size, 0)
        );
      } catch (e) {
        console.error(e);
        return Utils.humanReadableSize(0);
      }
    }

    /**
     * Keeps total cache size under a budget. When the sum across all cache DBs
     * exceeds `highWater`, evicts oldest entries (largest DBs first) until back
     * under `lowWater`. Cheap to call when already under budget (just a sum).
     * @param {number} highWater bytes
     * @param {number} lowWater bytes
     * @returns {Promise<void>}
     */
    async enforceBudget(highWater, lowWater) {
      try {
        const dbnames = await this.#getAllDBNames();
        if (!dbnames.length) return;
        const sized = [];
        let total = 0;
        for (const dbName of dbnames) {
          let size = 0;
          try {
            size = await Utils.getDatabaseSize(dbName);
          } catch (e) {}
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
        console.info(
          "Translation cache trimmed:",
          Utils.humanReadableSize(total),
          "->",
          Utils.humanReadableSize(lowWater)
        );
      } catch (e) {
        console.debug("enforceBudget failed", e);
      }
    }
  }

  // Create a translation cache list.
  const cacheList = new CacheList();

  /**
   * Get a new translation cache entry.
   * @param {string} translationService
   * @param {string} sourceLanguage
   * @param {string} targetLanguage
   * @param {string} originalText
   * @returns {Promise<CacheEntry>} cacheEntry
   */
  translationCache.get = async (
    translationService,
    sourceLanguage,
    targetLanguage,
    originalText
  ) => {
    try {
      const cache = await cacheList.getCache(
        translationService,
        sourceLanguage,
        targetLanguage
      );
      return await cache.query(originalText);
    } catch (e) {
      console.error(e);
    }
  };

  // --- TWP-FullPage: cache size budget -------------------------------------
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
  function maybeEnforceCacheBudget(force) {
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

  /**
   * Defines a new entry in the translation cache.
   * @param {string} translationService
   * @param {string} sourceLanguage
   * @param {string} targetLanguage
   * @param {string} originalText
   * @param {string} translatedText
   * @param {string} detectedLanguage
   * @returns {Promise<boolean>}
   */
  translationCache.set = async (
    translationService,
    sourceLanguage,
    targetLanguage,
    originalText,
    translatedText,
    detectedLanguage
  ) => {
    try {
      const cache = await cacheList.getCache(
        translationService,
        sourceLanguage,
        targetLanguage
      );
      const ok = await cache.add(originalText, translatedText, detectedLanguage);
      maybeEnforceCacheBudget(false);
      return ok;
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * Delete all translation caches.
   * If `reload` is `true` reloads the extension after deleting caches.
   * @param {boolean} reload
   */
  translationCache.deleteTranslationCache = async (reload = false) => {
    try {
      // Deletes old translation cache.
      if (indexedDB && indexedDB.deleteDatabase) {
        indexedDB.deleteDatabase("googleCache");
        indexedDB.deleteDatabase("yandexCache");
        indexedDB.deleteDatabase("bingCache");
      }
      // Delete the new translation cache.
      await cacheList.deleteAll();
    } catch (e) {
      console.error(e);
    } finally {
      if (reload) chrome.runtime.reload();
    }
  };

  let promiseCalculatingStorage = null;
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "getCacheSize") {
      if (!promiseCalculatingStorage) {
        promiseCalculatingStorage = cacheList.calculateSize();
      }

      promiseCalculatingStorage
        .then((size) => {
          promiseCalculatingStorage = null;
          sendResponse(size);
          return size;
        })
        .catch((e) => {
          console.error(e);
          promiseCalculatingStorage = null;
          sendResponse("0B");
          return "0B";
        });
      return true;
    } else if (request.action === "deleteTranslationCache") {
      translationCache.deleteTranslationCache(request.reload);
    }
  });

  return translationCache;
})();
