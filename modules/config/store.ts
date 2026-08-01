import { storage, type WxtStorageItem } from 'wxt/utils/storage';
import { fixTLanguageCode } from '../languages';
import {
  applyConfigMigrations,
  CONFIG_SCHEMA_VERSION,
  type Config,
  type ConfigKey,
  defaultConfig,
  legacyStorageKeyByConfigKey,
} from './schema';

/**
 * TypeScript port of the vanilla-JS extension's `twpConfig` (lib/config.js).
 * Same public surface (get/set/onReady/onChanged/import/export/
 * restoreToDefault + the array/map mutators), but built on `wxt/storage`
 * instead of raw `chrome.storage.local` + a hand-rolled observer array.
 *
 * Storage shape: one top-level chrome.storage.local key per config key
 * (matching the old code exactly, not one combined blob), so an existing
 * install's stored settings load without any migration step. A couple of
 * keys were renamed for style during the port (deepl_confirmed ->
 * deeplConfirmed) — legacyStorageKeyByConfigKey maps those back to their old
 * storage key so this reads an existing install's data under the OLD name
 * once, the first time each key is read. (`translateTag_pre`/`translateTagPre`
 * used to be the other entry here — both spellings were deleted outright in
 * the dead-config-key cleanup, `CONFIG_SCHEMA_VERSION` 2, since the setting
 * was never read anywhere.)
 *
 * Unlike the old `onChanged`, this returns an unsubscribe function. The old
 * version had no way to unsubscribe at all (every caller just accumulated a
 * permanent listener) — that's exactly the bug class fixed in
 * contentScript/translateSelected.js during the earlier bug-fix pass on this
 * repo. Don't reintroduce it here.
 */

const DEFAULT_TARGET_LANGUAGES = ['en', 'es', 'de'];

/**
 * Every config key lives in `chrome.storage.local`, full stop.
 *
 * **Do not reintroduce `chrome.storage.sync` here.** Gen 2 Session 4 routed a
 * subset of keys (`SYNCED_CONFIG_KEYS`, now deleted) to `sync:` for
 * cross-device settings sync, feature-detected on `!!browser.storage.sync`.
 * That detection only proves the API *exists*, not that it *works* — and on
 * WebKit-based browsers (a real user hit this on Orion for iOS) it can be
 * present-but-non-functional, or work in extension pages while returning
 * nothing in content scripts. The result was a split brain with no error
 * anywhere: the options page wrote and read `sync:alwaysTranslateSites`, so a
 * site visibly appeared in the always-translate list, while content-main read
 * the same key, got an empty array, and therefore never auto-translated. That
 * is exactly the "it's in the list but the site never translates" report, and
 * it survived the separate permission-model revert (see CLAUDE.md) because it
 * was always an independent second bug that happened to ship in the same
 * session.
 *
 * The pre-rewrite fork this project came from used `chrome.storage.local`
 * exclusively and never had this failure mode. Asked to choose between a
 * dual-write scheme that preserved sync and simply dropping sync, the user
 * chose to drop it ("it's just a couple clicks in a site I can do it").
 * Export/import in Settings → Backup remains the supported way to move
 * settings between devices.
 */
function storageKeyFor(name: ConfigKey): `local:${string}` {
  return `local:${legacyStorageKeyByConfigKey[name] ?? name}`;
}

const configSchemaVersionItem = storage.defineItem<number>('local:configSchemaVersion', { fallback: 0 });
const syncReclaimCompleteItem = storage.defineItem<boolean>('local:syncReclaimComplete', { fallback: false });

/** Runs any pending migrations against raw storage before the normal per-key loading below reads it. No-op on a fully up-to-date install (the common case) since it's gated on the stored version number. */
async function migrateStorageIfNeeded(): Promise<void> {
  const storedVersion = await configSchemaVersionItem.getValue();
  if (storedVersion >= CONFIG_SCHEMA_VERSION) return;

  const rawEntries = await browser.storage.local.get(null);
  const migrated = applyConfigMigrations(rawEntries, storedVersion);

  const changedEntries = Object.fromEntries(
    Object.entries(migrated).filter(([key, value]) => rawEntries[key] !== value),
  );
  if (Object.keys(changedEntries).length > 0) {
    await browser.storage.local.set(changedEntries);
  }

  // A migration signals "delete this key" by omitting it from its returned
  // object (`delete entries[key]`) rather than by a magic value — detect
  // that here and actually remove it from storage. browser.storage.local.set
  // above only ever merges, so a key a migration dropped would otherwise
  // just sit there orphaned forever instead of actually going away.
  const removedKeys = Object.keys(rawEntries).filter((key) => !Object.hasOwn(migrated, key));
  if (removedKeys.length > 0) {
    await browser.storage.local.remove(removedKeys);
  }

  await configSchemaVersionItem.setValue(CONFIG_SCHEMA_VERSION);
}

/**
 * One-time rescue for anyone who ran a build between Gen 2 Session 4 and the
 * removal of sync storage: their settings for the formerly-synced keys were
 * written to `chrome.storage.sync` and are now orphaned, since nothing reads
 * that area anymore. Without this, dropping sync would look to those users
 * like their languages and always/never-translate lists silently reset to
 * defaults — the second confusing "my settings vanished" event in a row.
 *
 * Copies any such value back into `local:` **only where local doesn't already
 * have one**, so a local value (which is what every context actually reads,
 * and therefore what the user has been editing most recently) always wins
 * over a possibly-stale synced copy. Runs once, behind its own flag.
 */
async function reclaimSettingsStrandedInSyncIfNeeded(): Promise<void> {
  if (typeof browser === 'undefined' || !browser.storage?.sync) return;
  if (await syncReclaimCompleteItem.getValue()) return;

  try {
    const [syncEntries, localEntries] = await Promise.all([
      browser.storage.sync.get(null),
      browser.storage.local.get(null),
    ]);

    const toLocal: Record<string, unknown> = {};
    for (const name of Object.keys(defaultConfig) as ConfigKey[]) {
      const rawLocalKey = legacyStorageKeyByConfigKey[name] ?? name;
      if (Object.hasOwn(localEntries, rawLocalKey)) continue; // local wins
      if (Object.hasOwn(syncEntries, name)) toLocal[rawLocalKey] = syncEntries[name];
    }

    if (Object.keys(toLocal).length > 0) {
      await browser.storage.local.set(toLocal);
    }
  } catch (e) {
    // Sync being unreadable is the whole reason this code exists — a browser
    // where it throws is precisely the broken-sync case, and there's nothing
    // to reclaim there anyway. Never let it block config init.
    console.warn('[twpConfig] could not read sync storage while reclaiming old settings', e);
  }
  await syncReclaimCompleteItem.setValue(true);
}

const items = Object.fromEntries(
  (Object.keys(defaultConfig) as ConfigKey[]).map((name) => [
    name,
    storage.defineItem(storageKeyFor(name), { fallback: defaultConfig[name] }),
  ]),
) as { [K in ConfigKey]: WxtStorageItem<Config[K], {}> };

const state = { ...defaultConfig };

type Listener = (name: ConfigKey, newValue: unknown) => void;
const listeners = new Set<Listener>();

let configIsReady = false;
let readyPromise: Promise<void> | null = null;
const onReadyCallbacks: Array<() => void> = [];

function notify(name: ConfigKey, newValue: unknown) {
  listeners.forEach((cb) => {
    cb(name, newValue);
  });
}

// Every item watches itself so state[] stays current and onChanged fires for
// changes made from ANY context (including this one) — chrome.storage's own
// onChanged event already covers same-context writes, so there's no need to
// separately notify from set().
for (const name of Object.keys(items) as ConfigKey[]) {
  items[name].watch((newValue) => {
    (state as any)[name] = newValue;
    notify(name, newValue);
  });
}

async function initConfig(): Promise<void> {
  await migrateStorageIfNeeded();
  await reclaimSettingsStrandedInSyncIfNeeded();

  // Load every key's current stored value (or its fallback) into state.
  await Promise.all(
    (Object.keys(items) as ConfigKey[]).map(async (name) => {
      (state as any)[name] = await items[name].getValue();
    }),
  );

  // --- target-language backfill, ported from lib/config.js ---
  if (state.targetLanguages.some((tl) => !tl)) {
    state.targetLanguages = [...DEFAULT_TARGET_LANGUAGES];
  }

  if (typeof browser !== 'undefined' && browser.i18n?.getAcceptLanguages) {
    const acceptedLanguages = await browser.i18n.getAcceptLanguages();
    for (const lang of acceptedLanguages) {
      if (state.targetLanguages.length >= 3) break;
      const fixed = fixTLanguageCode(lang);
      if (fixed && !state.targetLanguages.includes(fixed)) {
        state.targetLanguages.push(fixed);
      }
    }
  }

  for (const lang of DEFAULT_TARGET_LANGUAGES) {
    if (state.targetLanguages.length >= 3) break;
    if (!state.targetLanguages.includes(lang)) {
      state.targetLanguages.push(lang);
    }
  }

  while (state.targetLanguages.length > 3) state.targetLanguages.pop();

  if (!state.targetLanguage || !state.targetLanguages.includes(state.targetLanguage)) {
    state.targetLanguage = state.targetLanguages[0] ?? null;
  }
  if (!state.targetLanguageTextTranslation || !state.targetLanguages.includes(state.targetLanguageTextTranslation)) {
    state.targetLanguageTextTranslation = state.targetLanguages[0] ?? null;
  }

  state.targetLanguages = state.targetLanguages.map((lang) => fixTLanguageCode(lang) ?? lang);
  state.neverTranslateLangs = state.neverTranslateLangs.map((lang) => fixTLanguageCode(lang) ?? lang);
  state.alwaysTranslateLangs = state.alwaysTranslateLangs.map((lang) => fixTLanguageCode(lang) ?? lang);
  state.targetLanguage = fixTLanguageCode(state.targetLanguage) ?? state.targetLanguage;
  state.targetLanguageTextTranslation =
    fixTLanguageCode(state.targetLanguageTextTranslation) ?? state.targetLanguageTextTranslation;

  if (!state.targetLanguage || !state.targetLanguages.includes(state.targetLanguage)) {
    state.targetLanguage = state.targetLanguages[0] ?? null;
  }
  if (!state.targetLanguageTextTranslation || !state.targetLanguages.includes(state.targetLanguageTextTranslation)) {
    state.targetLanguageTextTranslation = state.targetLanguages[0] ?? null;
  }

  await Promise.all([
    items.targetLanguages.setValue(state.targetLanguages),
    items.targetLanguage.setValue(state.targetLanguage),
    items.targetLanguageTextTranslation.setValue(state.targetLanguageTextTranslation),
    items.neverTranslateLangs.setValue(state.neverTranslateLangs),
    items.alwaysTranslateLangs.setValue(state.alwaysTranslateLangs),
  ]);

  configIsReady = true;
  onReadyCallbacks.forEach((cb) => {
    cb();
  });
  onReadyCallbacks.length = 0;
}

export const twpConfig = {
  onReady(callback?: () => void): Promise<void> {
    if (!readyPromise) readyPromise = initConfig();
    if (callback) {
      if (configIsReady) callback();
      else onReadyCallbacks.push(callback);
    }
    return readyPromise;
  },

  get<K extends ConfigKey>(name: K): Config[K] {
    return state[name];
  },

  async set<K extends ConfigKey>(name: K, value: Config[K]): Promise<void> {
    (state as any)[name] = value;
    try {
      await items[name].setValue(value);
    } catch (e) {
      // local: storage has an effectively unlimited quota, so this is now
      // unlikely — kept because a storage write can still fail for reasons
      // outside our control (disk pressure, a locked-down profile), and
      // `state` is already updated above so the current session keeps
      // behaving correctly. Better than an unhandled rejection breaking
      // whatever UI action triggered the write.
      console.error(`[twpConfig] failed to persist "${name}"`, e);
    }
    // items[name].watch() above also fires from this same write (chrome
    // storage.onChanged fires in every context, including the writer's), so
    // notify() isn't called again here to avoid a double notification.
  },

  /** Returns an unsubscribe function — always call it when done listening. */
  onChanged(callback: Listener): () => void {
    listeners.add(callback);
    return () => listeners.delete(callback);
  },

  async export(): Promise<string> {
    const out: Record<string, unknown> = {
      timeStamp: Date.now(),
      version: browser.runtime.getManifest().version,
    };
    for (const name of Object.keys(defaultConfig) as ConfigKey[]) {
      out[name] = state[name];
    }
    return JSON.stringify(out, null, 4);
  },

  async import(json: string): Promise<void> {
    const parsed = JSON.parse(json);
    await Promise.all(
      (Object.keys(defaultConfig) as ConfigKey[])
        .filter((name) => typeof parsed[name] !== 'undefined')
        .map((name) => twpConfig.set(name, parsed[name])),
    );
    browser.runtime.reload();
  },

  async restoreToDefault(): Promise<void> {
    await twpConfig.import(JSON.stringify(defaultConfig));
  },

  // --- array/map mutators, ported 1:1 from lib/config.js ---

  async addSiteToTranslateWhenHovering(hostname: string): Promise<void> {
    await addInArray('sitesToTranslateWhenHovering', hostname);
  },
  async removeSiteFromTranslateWhenHovering(hostname: string): Promise<void> {
    await removeFromArray('sitesToTranslateWhenHovering', hostname);
  },
  async addLangToTranslateWhenHovering(lang: string): Promise<void> {
    await addInArray('langsToTranslateWhenHovering', lang);
  },
  async removeLangFromTranslateWhenHovering(lang: string): Promise<void> {
    await removeFromArray('langsToTranslateWhenHovering', lang);
  },

  async addSiteToAlwaysTranslate(hostname: string): Promise<void> {
    await addInArray('alwaysTranslateSites', hostname);
    await removeFromArray('neverTranslateSites', hostname);
  },
  async removeSiteFromAlwaysTranslate(hostname: string): Promise<void> {
    await removeFromArray('alwaysTranslateSites', hostname);
  },
  async addSiteToNeverTranslate(hostname: string): Promise<void> {
    await addInArray('neverTranslateSites', hostname);
    await removeFromArray('alwaysTranslateSites', hostname);
    await removeFromArray('sitesToTranslateWhenHovering', hostname);
  },
  async removeSiteFromNeverTranslate(hostname: string): Promise<void> {
    await removeFromArray('neverTranslateSites', hostname);
  },

  async addKeyWordToCustomDictionary(key: string, value: string): Promise<void> {
    if (typeof state.customDictionary[key] === 'undefined') {
      await twpConfig.set('customDictionary', { ...state.customDictionary, [key]: value });
    }
  },
  async removeKeyWordFromCustomDictionary(keyWord: string): Promise<void> {
    if (typeof state.customDictionary[keyWord] !== 'undefined') {
      const next = { ...state.customDictionary };
      delete next[keyWord];
      await twpConfig.set('customDictionary', next);
    }
  },

  async addLangToAlwaysTranslate(lang: string, hostname?: string): Promise<void> {
    await addInArray('alwaysTranslateLangs', lang);
    await removeFromArray('neverTranslateLangs', lang);
    if (hostname) await removeFromArray('neverTranslateSites', hostname);
  },
  async removeLangFromAlwaysTranslate(lang: string): Promise<void> {
    await removeFromArray('alwaysTranslateLangs', lang);
  },
  async addLangToNeverTranslate(lang: string, hostname?: string): Promise<void> {
    await addInArray('neverTranslateLangs', lang);
    await removeFromArray('alwaysTranslateLangs', lang);
    await removeFromArray('langsToTranslateWhenHovering', lang);
    if (hostname) await removeFromArray('alwaysTranslateSites', hostname);
  },
  async removeLangFromNeverTranslate(lang: string): Promise<void> {
    await removeFromArray('neverTranslateLangs', lang);
  },

  /**
   * Add a new lang to targetLanguages (moving it to the front if already
   * present, otherwise bumping the last entry out) and set it as
   * targetLanguage for page translation only.
   */
  async setTargetLanguage(lang: string, forTextToo = false): Promise<void> {
    const fixed = fixTLanguageCode(lang);
    if (!fixed) return;

    if (!state.targetLanguages.includes(fixed) || forTextToo) {
      await addTargetLanguage(fixed);
    }

    await twpConfig.set('targetLanguage', fixed);

    if (forTextToo) {
      await twpConfig.setTargetLanguageTextTranslation(fixed);
    }
  },

  async setTargetLanguageTextTranslation(lang: string): Promise<void> {
    const fixed = fixTLanguageCode(lang);
    if (!fixed) return;
    await twpConfig.set('targetLanguageTextTranslation', fixed);
  },

  /** Switch between page-translation services that are enabled. Returns the new service name. */
  async swapPageTranslationService(): Promise<Config['pageTranslatorService']> {
    const pageTranslationServices: Config['pageTranslatorService'][] = ['google', 'bing', 'yandex'];
    const enabled = state.enabledServices.filter((sv): sv is Config['pageTranslatorService'] =>
      pageTranslationServices.includes(sv as Config['pageTranslatorService']),
    );
    const index = enabled.indexOf(state.pageTranslatorService);
    // Falls back to 'google' only if every page-translation service has been
    // disabled — otherwise enabled[0] always exists.
    const next = (index !== -1 ? (enabled[index + 1] ?? enabled[0]) : enabled[0]) ?? 'google';
    await twpConfig.set('pageTranslatorService', next);
    return next;
  },
};

async function addInArray(configName: ArrayConfigKey, value: string): Promise<void> {
  const array = state[configName];
  if (!array.includes(value)) {
    await twpConfig.set(configName, [...array, value]);
  }
}

async function removeFromArray(configName: ArrayConfigKey, value: string): Promise<void> {
  const array = state[configName];
  if (array.includes(value)) {
    await twpConfig.set(
      configName,
      array.filter((v) => v !== value),
    );
  }
}

async function addTargetLanguage(lang: string): Promise<void> {
  const targetLanguages = [...state.targetLanguages];
  const index = targetLanguages.indexOf(lang);
  if (index === -1) {
    targetLanguages.unshift(lang);
    targetLanguages.pop();
  } else {
    targetLanguages.splice(index, 1);
    targetLanguages.unshift(lang);
  }
  await twpConfig.set('targetLanguages', targetLanguages);
}

type ArrayConfigKey = {
  [K in ConfigKey]: Config[K] extends string[] ? K : never;
}[ConfigKey];
