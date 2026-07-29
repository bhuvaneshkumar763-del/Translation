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

  // Filled in during Phase 2+: translateText,
  // translateSingleText, detectTabLanguage, getMainFrameTabLanguage,
  // getMainFramePageLanguageState, setPageLanguageState,
  // removeTranslationsWithError, swapTranslationService,
  // getCurrentPageTranslatorService, currentTargetLanguage,
  // getCurrentPageLanguage, getOriginalTabLanguage.
  //
  // Filled in during Phase 3: textToSpeech, stopAudio, the
  // offscreen_{google,bing}_* actions, translateTextWithDeepL,
  // DeepL_firstTranslationResult, createLibreService, removeLibreService,
  // createDeeplFreeApiService, removeDeeplFreeApiService.
  //
  // Filled in during Phase 4: getTabHostName (bubble + others also use this),
  // openOptionsPage.
  //
  // Filled in during Phase 5: TranslateSelectedText, hotTranslateSelectedText,
  // thisFrameIsInFocus, anotherFrameIsInFocus, improveTranslation,
  // getCurrentSourceLanguage, getDontSortResults, showPopupMobile,
  // autoTranslateBecauseClickedALink.
  //
  // Filled in during Phase 6: authorizationToOpenOptions,
  // restorePagesWithServiceNames, getTabMimeType.
  //
  // Filled in during Phase 7: getCacheSize, deleteTranslationCache,
  // contentScriptIsInjected, cleanUp.
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
