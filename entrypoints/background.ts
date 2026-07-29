import { twpConfig } from '@/modules/config/store';
import { translationService, initProviderRegistry } from '@/modules/providers/registry';
import { initTextToSpeech } from '@/modules/tts/offscreenClient';
import { onMessage, sendMessage } from '@/modules/messaging/protocol';

/**
 * Background: config init + the message router for translation (Google/
 * Bing/Yandex/DeepL — LibreTranslate and DeepL-free-API register themselves
 * from stored config via initProviderRegistry) and text-to-speech (relayed
 * to the offscreen document), plus a minimal toolbar-icon trigger standing
 * in for the real popup (Phase 6). Ported from background/background.js +
 * background/translationService.js's chrome.runtime.onMessage router — most
 * of background.js's other responsibilities (context menus, commands,
 * tab-icon state, the useOldPopup swap) are NOT here yet, see later phases.
 */
/** Per-tab cache so subframes can learn the main frame's detected language/translation state without redetecting it themselves. Cleared as tabs close. */
const tabLanguageByTabId = new Map<number, string>();
const tabPageStateByTabId = new Map<number, 'original' | 'translated'>();

export default defineBackground(() => {
  twpConfig.onReady(() => {
    // Ported from lib/platformInfo.js's `if (chrome.tabs) twpConfig.set("originalUserAgent", ...)`
    // — snapshotting the background's own navigator.userAgent once, since
    // some platforms give content scripts a different (spoofed/overridden)
    // user agent than the browser's real one.
    void twpConfig.set('originalUserAgent', navigator.userAgent);
  });
  initProviderRegistry();
  initTextToSpeech();

  browser.tabs.onRemoved.addListener((tabId) => {
    tabLanguageByTabId.delete(tabId);
    tabPageStateByTabId.delete(tabId);
  });

  onMessage('getTabHostName', (message) => {
    const url = message.sender.tab?.url;
    if (!url) return '';
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  });

  onMessage('translateSingleText', async (message) => {
    const { serviceName, sourceLanguage, targetLanguage, text } = message.data;
    return await translationService.translateSingleText(serviceName, sourceLanguage, targetLanguage, text);
  });

  onMessage('thisFrameIsInFocus', (message) => {
    const tabId = message.sender.tab?.id;
    if (tabId != null) void sendMessage('anotherFrameIsInFocus', undefined, tabId).catch(() => {});
  });

  onMessage('reportMainFrameTabLanguage', (message) => {
    const tabId = message.sender.tab?.id;
    if (tabId != null) tabLanguageByTabId.set(tabId, message.data.language);
  });
  onMessage('getMainFrameTabLanguage', (message) => {
    const tabId = message.sender.tab?.id;
    return (tabId != null && tabLanguageByTabId.get(tabId)) || 'und';
  });
  onMessage('reportMainFramePageLanguageState', (message) => {
    const tabId = message.sender.tab?.id;
    if (tabId != null) tabPageStateByTabId.set(tabId, message.data.state);
  });
  onMessage('getMainFramePageLanguageState', (message) => {
    const tabId = message.sender.tab?.id;
    return (tabId != null && tabPageStateByTabId.get(tabId)) || 'original';
  });

  onMessage('translateHTML', async (message) => {
    const { translationService: serviceName, sourceLanguage, targetLanguage, sourceArray2d, dontSortResults } = message.data;
    return await translationService.translateHTML(
      serviceName,
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      // Disk cache isn't ported yet (Phase 7) — the in-memory placeholder in
      // modules/cache/translationCache.ts is used regardless of this flag.
      true,
      dontSortResults,
    );
  });

  onMessage('openOptionsPage', () => {
    // Stub until Phase 6 registers manifest.options_ui — harmlessly
    // no-ops/rejects until then rather than pointing at a path that
    // doesn't exist yet.
    browser.runtime.openOptionsPage().catch(() => {});
  });

  // Minimal translate/restore toggle via the toolbar icon, standing in for
  // the real popup (Phase 6) and the old code's translateClickingOnce path.
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id) return;
    const state = await sendMessage('getCurrentPageLanguageState', undefined, tab.id).catch(() => 'original' as const);
    if (state === 'translated') {
      await sendMessage('restorePage', undefined, tab.id);
    } else {
      await sendMessage('translatePage', { targetLanguage: twpConfig.get('targetLanguage') ?? undefined }, tab.id);
    }
  });
});
