import { z } from 'zod';

/**
 * Mirrors `defaultConfig` in the vanilla-JS extension's lib/config.js 1:1 —
 * same ~45 keys, same storage shapes (Maps/Sets as plain objects, matching
 * that file's `toObjectOrArrayIfTypeIsMapOrSet`/`fixObjectType`), so an
 * existing install's chrome.storage.local data loads without migration.
 *
 * Three keys used elsewhere in the old codebase via twpConfig.get/set but
 * absent from its own defaultConfig ("phantom" keys — see the cross-module
 * contract catalog) are intentionally folded in here as first-class fields
 * instead of being reproduced as an omission: originalUserAgent,
 * installDateTime, deeplConfirmed (was `deepl_confirmed`).
 *
 * `authorizationToOpenOptions` is NOT part of this schema — the old code
 * stores it via raw chrome.storage.local, not through twpConfig, and the new
 * code should keep doing the same (it's a one-shot handshake value, not a
 * user setting).
 */

const yesNo = z.enum(['yes', 'no']);

const customServiceSchema = z.union([
  z.object({
    name: z.literal('libre'),
    url: z.string(),
    apiKey: z.string(),
  }),
  z.object({
    name: z.literal('deepl_freeapi'),
    apiKey: z.string(),
  }),
  z.object({
    name: z.literal('llm'),
    baseUrl: z.string(),
    apiKey: z.string(),
    model: z.string(),
  }),
]);

const bubblePosSchema = z
  .object({
    side: z.enum(['left', 'right']),
    yFrac: z.number(),
  })
  .nullable();

export const configSchema = z.object({
  uiLanguage: z.string(), // "default" or a lang code
  // Keep in sync by hand with modules/providers/descriptors.ts's `roles`
  // filtered by 'page'/'text' — see that file's header comment for why this
  // isn't derived automatically (zod literal-type inference).
  pageTranslatorService: z.enum(['google', 'yandex', 'bing', 'llm', 'builtin']),
  textTranslatorService: z.enum(['google', 'yandex', 'bing', 'deepl', 'libre', 'llm', 'builtin']),
  textToSpeechService: z.enum(['google', 'bing']),
  enabledServices: z.array(z.string()),
  ttsSpeed: z.number(),
  ttsVolume: z.number(),
  targetLanguage: z.string().nullable(),
  targetLanguageTextTranslation: z.string().nullable(),
  targetLanguages: z.array(z.string()),
  alwaysTranslateSites: z.array(z.string()),
  neverTranslateSites: z.array(z.string()),
  sitesToTranslateWhenHovering: z.array(z.string()),
  langsToTranslateWhenHovering: z.array(z.string()),
  alwaysTranslateLangs: z.array(z.string()),
  neverTranslateLangs: z.array(z.string()),
  customDictionary: z.record(z.string(), z.string()), // Map<string,string> in memory
  showTranslatePageContextMenu: yesNo,
  showTranslateSelectedContextMenu: yesNo,
  showButtonInTheAddressBar: yesNo,
  showOriginalTextWhenHovering: yesNo,
  showTranslateSelectedButton: yesNo,
  whenShowMobilePopup: z.enum(['when-necessary', 'only-when-i-touch', 'always-show']),
  darkMode: z.enum(['auto', 'yes', 'no']),
  popupBlueWhenSiteIsTranslated: yesNo,
  popupPanelSection: z.number(),
  showReleaseNotes: yesNo,
  dontShowIfIsNotValidText: yesNo,
  dontShowIfPageLangIsTargetLang: yesNo,
  dontShowIfPageLangIsUnknown: yesNo,
  dontShowIfSelectedTextIsTargetLang: yesNo,
  dontShowIfSelectedTextIsUnknown: yesNo,
  hotkeys: z.record(z.string(), z.string()), // populated from chrome.commands.getAll()
  expandPanelTranslateSelectedText: yesNo,
  translateTagPre: yesNo, // was "translateTag_pre"
  enableIframePageTranslation: yesNo,
  dontSortResults: yesNo,
  translateDynamicallyCreatedContent: yesNo,
  autoTranslateWhenClickingALink: yesNo,
  translateSelectedWhenPressTwice: yesNo,
  translateTextOverMouseWhenPressTwice: yesNo,
  translateClickingOnce: yesNo,
  enableDiskCache: yesNo,
  useAlternativeService: yesNo,
  customServices: z.array(customServiceSchema),
  showMobilePopupOnDesktop: yesNo,
  popupMobileKeepOnScren: yesNo, // kept misspelled to match the existing storage key
  popupMobilePosition: z.enum(['top', 'bottom']),
  addPaddingToPage: yesNo,
  proxyServers: z.object({
    google: z
      .object({
        translateServer: z.string().optional(),
        ttsServer: z.string().optional(),
      })
      .optional(),
  }),

  // TWP-FullPage fork additions — must survive the rewrite, not just upstream keys.
  fpSourceLangByHost: z.record(z.string(), z.string()),
  fpShowFloatingBubble: yesNo,
  fpBubblePos: bubblePosSchema,
  fpBubbleByHost: z.record(z.string(), yesNo),

  // "Phantom" keys: read/written via twpConfig.get/set in the old code, but
  // absent from its own defaultConfig object (see contract catalog).
  originalUserAgent: z.string(),
  installDateTime: z.number(),
  deeplConfirmed: yesNo, // was "deepl_confirmed"
});

export type Config = z.infer<typeof configSchema>;
export type ConfigKey = keyof Config;

/**
 * Storage keys as they exist in the OLD extension's chrome.storage.local —
 * used only where a key name differs from ours (renamed for style during the
 * port), so store.ts can read the old key on first load without a migration
 * step for users upgrading in place.
 */
export const legacyStorageKeyByConfigKey: Partial<Record<ConfigKey, string>> = {
  translateTagPre: 'translateTag_pre',
  deeplConfirmed: 'deepl_confirmed',
};

export const defaultConfig: Config = {
  uiLanguage: 'default',
  pageTranslatorService: 'google',
  textTranslatorService: 'google',
  textToSpeechService: 'google',
  enabledServices: ['google', 'bing', 'yandex', 'deepl'],
  ttsSpeed: 1.0,
  ttsVolume: 1.0,
  targetLanguage: null,
  targetLanguageTextTranslation: null,
  targetLanguages: [],
  alwaysTranslateSites: [],
  neverTranslateSites: [],
  sitesToTranslateWhenHovering: [],
  langsToTranslateWhenHovering: [],
  alwaysTranslateLangs: [],
  neverTranslateLangs: [],
  customDictionary: {},
  showTranslatePageContextMenu: 'yes',
  showTranslateSelectedContextMenu: 'yes',
  showButtonInTheAddressBar: 'yes',
  showOriginalTextWhenHovering: 'no',
  showTranslateSelectedButton: 'yes',
  whenShowMobilePopup: 'when-necessary',
  darkMode: 'auto',
  popupBlueWhenSiteIsTranslated: 'yes',
  popupPanelSection: 1,
  showReleaseNotes: 'yes',
  dontShowIfIsNotValidText: 'yes',
  dontShowIfPageLangIsTargetLang: 'no',
  dontShowIfPageLangIsUnknown: 'no',
  dontShowIfSelectedTextIsTargetLang: 'no',
  dontShowIfSelectedTextIsUnknown: 'no',
  hotkeys: {},
  expandPanelTranslateSelectedText: 'no',
  translateTagPre: 'yes',
  enableIframePageTranslation: 'yes',
  dontSortResults: 'no',
  translateDynamicallyCreatedContent: 'yes',
  autoTranslateWhenClickingALink: 'no',
  translateSelectedWhenPressTwice: 'no',
  translateTextOverMouseWhenPressTwice: 'no',
  translateClickingOnce: 'no',
  enableDiskCache: 'no',
  useAlternativeService: 'yes',
  customServices: [],
  showMobilePopupOnDesktop: 'no',
  popupMobileKeepOnScren: 'no',
  popupMobilePosition: 'top',
  addPaddingToPage: 'no',
  proxyServers: {},
  fpSourceLangByHost: {},
  fpShowFloatingBubble: 'yes',
  fpBubblePos: null,
  fpBubbleByHost: {},
  originalUserAgent: '',
  installDateTime: 0,
  deeplConfirmed: 'no',
};

/**
 * Config versioning, introduced in Session 2 of the Gen 2 rebuild (see the
 * plan file) — there was no migration system at all before this. The
 * storage shape is per-key (see store.ts's header comment), not one blob,
 * so most additive/rename changes already self-migrate for free via each
 * item's `fallback` and `legacyStorageKeyByConfigKey`. This exists for the
 * cases that don't: a stored value whose *shape* changed (not just renamed)
 * or an enum value that was removed/renamed out from under existing
 * installs. Nothing needs migrating yet — this session's own schema changes
 * (new `llm` customServiceSchema variant, new enum entries) are purely
 * additive — so `configMigrations` ships empty. Add to it, and bump
 * `CONFIG_SCHEMA_VERSION`, the next time a change actually needs one.
 */
export const CONFIG_SCHEMA_VERSION = 1;

export interface ConfigMigration {
  /** The schema version this migration upgrades stored data TO. */
  toVersion: number;
  /** Rewrites raw chrome.storage.local entries (keyed by storage key, e.g. `translateTag_pre`, not necessarily the current config key name) in place. Only touch what needs changing — everything else passes through the normal per-key fallback/legacy-name loading untouched. */
  migrate(rawEntries: Record<string, unknown>): Record<string, unknown>;
}

export const configMigrations: ConfigMigration[] = [];

/** Applies every migration whose `toVersion` is above `storedVersion`, in ascending order. Pure — no storage I/O — so it's directly unit-testable; store.ts is responsible for reading/writing the actual chrome.storage.local entries and the version marker around this call. */
export function applyConfigMigrations(
  rawEntries: Record<string, unknown>,
  storedVersion: number,
): Record<string, unknown> {
  return configMigrations
    .filter((m) => m.toVersion > storedVersion)
    .sort((a, b) => a.toVersion - b.toVersion)
    .reduce((entries, m) => m.migrate(entries), rawEntries);
}
