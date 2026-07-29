import { defineExtensionMessaging } from '@webext-core/messaging';

/**
 * Typed replacement for the old code's `chrome.runtime.sendMessage({action:
 * "...", ...payload})` / `chrome.runtime.onMessage.addListener` pattern. Each
 * entry here is one method on the ProtocolMap; @webext-core/messaging keys
 * its wire format on the method name, so this plays the same role the old
 * `action` string did — see the cross-module contract catalog in the plan
 * (/root/.claude/plans/now-like-i-want-cozy-zebra.md) for the full ~45-entry
 * list this will grow to as each is ported in its own phase.
 *
 * Populated incrementally: only the entries an already-ported phase actually
 * uses should be uncommented/added here — an unused entry sitting in the type
 * with no real handler is a false promise about what's implemented.
 */
export interface ProtocolMap {
  // --- Phase 1: config + Google page-translation path ---
  // background -> content script (tab-targeted)
  getCurrentPageLanguageState(): 'original' | 'translated';
  translatePage(data?: { targetLanguage?: string }): void;
  restorePage(): void;
  // content script -> background
  translateHTML(data: {
    translationService: string;
    sourceLanguage: string;
    targetLanguage: string;
    sourceArray2d: string[][];
    dontSortResults?: boolean;
  }): string[][];

  // --- Phase 3: DeepL live-tab bridge ---
  // background -> the deepl.com content script bridge (tab-targeted)
  translateTextWithDeepL(data: { text: string; targetLanguage: string }): string;
  // deepl.com content script bridge -> background
  DeepL_firstTranslationResult(data: { result: string }): void;

  // --- Phase 3: text-to-speech (background <-> offscreen document) ---
  // content script/popup -> background
  textToSpeech(data: { text: string; targetLanguage: string }): void;
  stopAudio(): void;
  // background -> offscreen document (broadcast, no tabId — the offscreen
  // doc is just another extension context listening on chrome.runtime)
  offscreen_google_textToSpeech(data: { text: string; targetLanguage: string }): void;
  offscreen_bing_textToSpeech(data: { text: string; targetLanguage: string }): void;
  offscreen_google_stopAll(): void;
  offscreen_bing_stopAll(): void;
  offscreen_google_ttsSpeed(data: { speed: number }): void;
  offscreen_bing_ttsSpeed(data: { speed: number }): void;
  offscreen_google_ttsVolume(data: { volume: number }): void;
  offscreen_bing_ttsVolume(data: { volume: number }): void;

  // --- Phase 4: floating bubble ---
  // content script -> background. Opens the options page (a stub until
  // Phase 6 builds entrypoints/options/ and registers manifest.options_ui —
  // browser.runtime.openOptionsPage() harmlessly no-ops/rejects until then).
  openOptionsPage(): void;

  // Filled in during Phase 2+: translateText,
  // translateSingleText, detectTabLanguage, getMainFrameTabLanguage,
  // getMainFramePageLanguageState, setPageLanguageState,
  // removeTranslationsWithError, swapTranslationService,
  // getCurrentPageTranslatorService, currentTargetLanguage,
  // getCurrentPageLanguage, getOriginalTabLanguage.
  //
  // Filled in during Phase 5: TranslateSelectedText, hotTranslateSelectedText,
  // thisFrameIsInFocus, anotherFrameIsInFocus, improveTranslation,
  // getCurrentSourceLanguage, getDontSortResults, showPopupMobile,
  // autoTranslateBecauseClickedALink, getTabHostName (needed there because
  // translateSelected/popupMobile run in every frame, unlike the main-frame-
  // only bubble, which can just read location.hostname directly).
  //
  // Filled in during Phase 6: authorizationToOpenOptions,
  // restorePagesWithServiceNames, getTabMimeType.
  //
  // Filled in during Phase 7: getCacheSize, deleteTranslationCache,
  // contentScriptIsInjected, cleanUp.
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
