import { storage, type WxtStorageItem } from 'wxt/utils/storage';
import { fixTLanguageCode } from '../languages';
import { type Config, type ConfigKey, defaultConfig, legacyStorageKeyByConfigKey } from './schema';

/**
 * TypeScript port of the vanilla-JS extension's `twpConfig` (lib/config.js).
 * Same public surface (get/set/onReady/onChanged/import/export/
 * restoreToDefault + the array/map mutators), but built on `wxt/storage`
 * instead of raw `chrome.storage.local` + a hand-rolled observer array.
 *
 * Storage shape: one top-level chrome.storage.local key per config key
 * (matching the old code exactly, not one combined blob), so an existing
 * install's stored settings load without any migration step. A handful of
 * keys were renamed for style during the port (translateTag_pre ->
 * translateTagPre, deepl_confirmed -> deeplConfirmed) — legacyStorageKeyByConfigKey
 * maps those back to their old storage key so this reads an existing
 * install's data under the OLD name once, the first time each key is read.
 *
 * Unlike the old `onChanged`, this returns an unsubscribe function. The old
 * version had no way to unsubscribe at all (every caller just accumulated a
 * permanent listener) — that's exactly the bug class fixed in
 * contentScript/translateSelected.js during the earlier bug-fix pass on this
 * repo. Don't reintroduce it here.
 */

const DEFAULT_TARGET_LANGUAGES = ['en', 'es', 'de'];

function storageKeyFor(name: ConfigKey): `local:${string}` {
  return `local:${legacyStorageKeyByConfigKey[name] ?? name}`;
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
  listeners.forEach((cb) => cb(name, newValue));
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

  // --- hotkeys sync, ported from lib/config.js ---
  // chrome.commands is only available in the background/extension-page
  // context, not content scripts — same feature-detection guard as the old
  // code, so hotkeys only actually get (re)synced from wherever this runs
  // with access to it.
  if (typeof browser !== 'undefined' && browser.commands?.getAll) {
    try {
      const results = await browser.commands.getAll();
      const hotkeys = { ...state.hotkeys };
      for (const result of results) {
        if (result.name) hotkeys[result.name] = result.shortcut ?? '';
      }
      state.hotkeys = hotkeys;
      await items.hotkeys.setValue(hotkeys);
    } catch (e) {
      console.error(e);
    }
  }

  configIsReady = true;
  onReadyCallbacks.forEach((cb) => cb());
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
    await items[name].setValue(value);
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
