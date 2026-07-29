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

  // --- Phase 5: selection translation, hover tooltips, mobile popup ---
  // any frame -> background. Unlike the main-frame-only bubble (which can
  // just read location.hostname), these features run in every frame
  // (all_frames, matching the old translateSelected.js/showTranslated.js),
  // and a same-origin-policy-unaware iframe's own hostname isn't what
  // always/never-translate-site rules should key on — they should key on
  // the top-level tab's host, hence this round-trip.
  getTabHostName(): string;
  // content script -> background: single-string translation (selection
  // popup, hover tooltips), reusing the same provider registry as page
  // translation.
  translateSingleText(data: {
    serviceName: string;
    sourceLanguage: string;
    targetLanguage: string;
    text: string;
  }): string | undefined;
  // main frame -> background (on focus) -> background relays to every frame
  // of the tab, so a selection popup open in another frame closes itself
  // when a different frame takes focus (matches the old cross-frame
  // "thisFrameIsInFocus"/"anotherFrameIsInFocus" arbitration).
  thisFrameIsInFocus(): void;
  anotherFrameIsInFocus(): void;
  // background -> content script (tab-targeted), triggered by the keyboard
  // commands already declared in wxt.config.ts. The listeners are wired up
  // now; browser.commands.onCommand -> sendMessage(...) itself is Phase 7's
  // job alongside the rest of the commands/context-menus wiring.
  TranslateSelectedText(): void;
  hotTranslateSelectedText(): void;
  showPopupMobile(): void;
  // main frame -> background (report) / any frame -> background (read):
  // lets subframes (iframes, which can't run browser.i18n.detectLanguage
  // against the *page's* text — only their own) learn the top-level page's
  // detected original language and translation state without redetecting it
  // themselves.
  reportMainFrameTabLanguage(data: { language: string }): void;
  getMainFrameTabLanguage(): string;
  reportMainFramePageLanguageState(data: { state: 'original' | 'translated' }): void;
  getMainFramePageLanguageState(): 'original' | 'translated';

  // --- Phase 6: toolbar popup ---
  // popup (an extension page, not a content script) -> main frame's content
  // script, tab-targeted (the popup resolves its own tabId via
  // browser.tabs.query, so — unlike the Phase 5 entries above — there's no
  // sender.tab to relay through). Popup-readable config values (current
  // target language, current service, ...) don't need a round trip at all —
  // the popup reads twpConfig directly, same as every other surface.
  getOriginalTabLanguage(): string;
  swapTranslationService(): string;

  // Filled in during Phase 6 (later): authorizationToOpenOptions,
  // improveTranslation.
  //
  // Filled in during Phase 7: restorePagesWithServiceNames, getTabMimeType,
  // autoTranslateBecauseClickedALink, getCacheSize, deleteTranslationCache,
  // contentScriptIsInjected, cleanUp.
  //
  // Filled in during Phase 7: getCacheSize, deleteTranslationCache,
  // contentScriptIsInjected, cleanUp.
}

export const { sendMessage, onMessage } = defineExtensionMessaging<ProtocolMap>();
