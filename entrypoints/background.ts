import { twpConfig } from '@/modules/config/store';
import { translationService } from '@/modules/providers/registry';
import { onMessage, sendMessage } from '@/modules/messaging/protocol';

/**
 * Phase 1 background: config init + the message router for the Google
 * page-translation path, plus a minimal toolbar-icon trigger so there's a
 * real, clickable way to test end-to-end without waiting on the popup
 * rebuild (Phase 6). Ported from background/background.js +
 * background/translationService.js's chrome.runtime.onMessage router — most
 * of background.js's responsibilities (context menus, commands, tab-icon
 * state, the useOldPopup swap) are NOT here yet, see later phases.
 */
export default defineBackground(() => {
  twpConfig.onReady();

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
