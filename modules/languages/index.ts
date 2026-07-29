import { allLanguagesNames } from './allLanguagesNames';
import { supportedLanguages, type ServiceName } from './supportedLanguages';

export { allLanguagesNames, supportedLanguages };
export type { ServiceName };

/**
 * Ported from lib/languages.js's `twpLang` object. Only the config-independent
 * pieces live here for now (Phase 1) — `getAlternativeService`,
 * `getLanguageList`, and `codeToLanguage` also need the config/i18n modules
 * and are ported alongside them in Phase 2, once Bing/Yandex (and their
 * language-support fallback) are wired up.
 */

export const uiLanguages = Object.keys(allLanguagesNames);
export const targetLanguages = Object.keys(allLanguagesNames.en);

/**
 * Fix a UI language code to one this extension has display names for —
 * e.g. bare "pt"/"zh" (no region) map to the variant we actually ship
 * ("pt-BR"/"zh-CN"). Returns undefined if it can't be resolved.
 */
export function fixUILanguageCode(langCode: unknown): string | undefined {
  if (typeof langCode !== 'string') return undefined;

  function getReplacer(code: string): string | undefined {
    switch (code) {
      case 'pt':
        return 'pt-BR';
      case 'zh':
        return 'zh-CN';
      default:
        return undefined;
    }
  }

  let code = langCode;
  if (!uiLanguages.includes(code)) {
    if (code.includes('-')) {
      code = code.split('-')[0];
      if (!uiLanguages.includes(code)) {
        return getReplacer(langCode);
      }
    } else {
      return getReplacer(code);
    }
  }

  return code;
}

/**
 * Fix a target-language code to one of the languages this extension actually
 * translates to/from — e.g. "zh" -> "zh-CN", "zh-Hant" -> "zh-TW",
 * "iw" -> "he" (old Hebrew code), "jw" -> "jv" (old Javanese code). Returns
 * undefined if it can't be resolved to a supported target language.
 */
export function fixTLanguageCode(langCode: unknown): string | undefined {
  if (typeof langCode !== 'string') return undefined;

  if (langCode === 'zh') return 'zh-CN';
  if (langCode === 'zh-Hant') return 'zh-TW';
  if (langCode === 'iw') return 'he';
  if (langCode === 'jw') return 'jv';

  let code = langCode;
  if (!targetLanguages.includes(code)) {
    if (code.includes('-')) {
      code = code.split('-')[0];
      if (!targetLanguages.includes(code)) {
        return undefined;
      }
    } else {
      return undefined;
    }
  }

  return code;
}

const RTL_LANGUAGES = [
  'ar',
  'ckb',
  'dv',
  'fa',
  'he', // was "iw"
  'ks',
  'ms-Arab',
  'pa-Arab',
  'prs', // fa-AF
  'ps',
  'sd',
  'ug',
  'ur',
  'yi',
];

export function isRtlLanguage(langCode: string): boolean {
  return RTL_LANGUAGES.includes(langCode);
}
