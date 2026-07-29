import { twpConfig } from '@/modules/config/store';
import { translationService, initProviderRegistry } from '@/modules/providers/registry';
import { initTextToSpeech } from '@/modules/tts/offscreenClient';
import { translationCache } from '@/modules/cache/translationCache';
import { onMessage, sendMessage } from '@/modules/messaging/protocol';
import { mainFrameTarget, pageActionTarget } from '@/modules/messaging/tabTarget';

/**
 * Background: config init + the message router for translation (Google/
 * Bing/Yandex/DeepL — LibreTranslate and DeepL-free-API register themselves
 * from stored config via initProviderRegistry) and text-to-speech (relayed
 * to the offscreen document), the toolbar-icon click, context menus,
 * keyboard commands, and a chrome.alarms-based keepalive. Ported from
 * background/background.js + background/translationService.js's
 * chrome.runtime.onMessage router.
 */

/** Per-tab cache so subframes can learn the main frame's detected language/translation state without redetecting it themselves. Cleared as tabs close. */
const tabLanguageByTabId = new Map<number, string>();
const tabPageStateByTabId = new Map<number, 'original' | 'translated'>();

/** Sends the toggle to the main frame only, or every frame, depending on enableIframePageTranslation — matches the old code's sendToggleTranslationMessage. */
function toggleTranslationForTab(tabId: number): void {
  void sendMessage('toggleTranslation', undefined, pageActionTarget(tabId)).catch(() => {});
}

/**
 * Ported from the old background.js's resetBrowserAction: with
 * translateClickingOnce on, the popup is cleared so the toolbar-icon click
 * fires action.onClicked (toggle translation) instead; otherwise the click
 * opens whichever popup skin useOldPopup selects. forceShow bypasses the
 * translateClickingOnce carve-out so the "Show popup" context menu works
 * even in click-once mode.
 */
function resetBrowserAction(forceShow = false): void {
  if (twpConfig.get('translateClickingOnce') === 'yes' && !forceShow) {
    void browser.action.setPopup({ popup: '' });
  } else {
    const popupPath = twpConfig.get('useOldPopup') === 'yes' ? '/old-popup.html' : '/popup.html';
    void browser.action.setPopup({ popup: browser.runtime.getURL(popupPath) });
  }
}

const CONTEXT_MENU_IDS = {
  translatePage: 'translate-web-page',
  translateRestoreThisFrame: 'translate-restore-this-frame',
  translateSelectedText: 'translate-selected-text',
  showPopup: 'browserAction-showPopup',
  neverTranslate: 'never-translate',
  moreOptions: 'more-options',
} as const;

function updatePageContextMenu(pageLanguageState: 'original' | 'translated' = 'original'): void {
  if (!browser.contextMenus) return;

  const title =
    pageLanguageState === 'translated'
      ? 'Show original'
      : `Translate to ${twpConfig.get('targetLanguage') ?? 'target language'}`;

  browser.contextMenus.remove(CONTEXT_MENU_IDS.translatePage).catch(() => {});
  browser.contextMenus.remove(CONTEXT_MENU_IDS.translateRestoreThisFrame).catch(() => {});

  const documentUrlPatterns = ['http://*/*', 'https://*/*', 'file://*/*', 'ftp://*/*'];

  if (twpConfig.get('showTranslatePageContextMenu') === 'yes') {
    if (twpConfig.get('enableIframePageTranslation') === 'yes') {
      browser.contextMenus.create({ id: CONTEXT_MENU_IDS.translatePage, title, contexts: ['page', 'frame'], documentUrlPatterns });
    } else {
      browser.contextMenus.create({ id: CONTEXT_MENU_IDS.translatePage, title, contexts: ['page'], documentUrlPatterns });
    }
  }

  if (twpConfig.get('enableIframePageTranslation') !== 'yes') {
    browser.contextMenus.create({
      id: CONTEXT_MENU_IDS.translateRestoreThisFrame,
      title: 'Translate/restore this frame',
      contexts: ['frame'],
      documentUrlPatterns: ['http://*/*', 'https://*/*'],
    });
  }
}

function updateSelectedTextContextMenu(): void {
  if (!browser.contextMenus) return;
  browser.contextMenus.remove(CONTEXT_MENU_IDS.translateSelectedText).catch(() => {});
  if (twpConfig.get('showTranslateSelectedContextMenu') === 'yes') {
    browser.contextMenus.create({
      id: CONTEXT_MENU_IDS.translateSelectedText,
      title: 'Translate selected text',
      contexts: ['selection'],
    });
  }
}

function updateActionContextMenu(): void {
  if (!browser.contextMenus) return;
  browser.contextMenus.remove(CONTEXT_MENU_IDS.showPopup).catch(() => {});
  browser.contextMenus.remove(CONTEXT_MENU_IDS.neverTranslate).catch(() => {});
  browser.contextMenus.remove(CONTEXT_MENU_IDS.moreOptions).catch(() => {});
  browser.contextMenus.create({ id: CONTEXT_MENU_IDS.showPopup, title: 'Show popup', contexts: ['action'] });
  browser.contextMenus.create({ id: CONTEXT_MENU_IDS.neverTranslate, title: 'Never translate this site', contexts: ['action'] });
  browser.contextMenus.create({ id: CONTEXT_MENU_IDS.moreOptions, title: 'More options', contexts: ['action'] });
}

export default defineBackground(() => {
  twpConfig.onReady(() => {
    // Ported from lib/platformInfo.js's `if (chrome.tabs) twpConfig.set("originalUserAgent", ...)`
    // — snapshotting the background's own navigator.userAgent once, since
    // some platforms give content scripts a different (spoofed/overridden)
    // user agent than the browser's real one.
    void twpConfig.set('originalUserAgent', navigator.userAgent);

    updatePageContextMenu();
    updateSelectedTextContextMenu();
    updateActionContextMenu();
    resetBrowserAction();

    twpConfig.onChanged((name) => {
      if (name === 'showTranslateSelectedContextMenu') updateSelectedTextContextMenu();
      else if (name === 'showTranslatePageContextMenu' || name === 'enableIframePageTranslation' || name === 'targetLanguage') {
        updatePageContextMenu();
      } else if (name === 'useOldPopup' || name === 'translateClickingOnce') {
        resetBrowserAction();
      }
    });
  });
  initProviderRegistry();
  initTextToSpeech();

  // A lightweight chrome.alarms-based keepalive — the old code had none (a
  // real gap under MV3's ~30s service-worker idle timeout). This is on top
  // of, not instead of, modules/providers/types.ts's task-scoped
  // swKeepAlive (which pings more aggressively but only while a translation
  // batch is actually in flight); this one just keeps the worker generally
  // more available between actions.
  browser.alarms.create('twp-keepalive', { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'twp-keepalive') {
      // The wake itself is the point; touch a trivial API so this isn't an
      // entirely empty handler.
      void browser.runtime.getPlatformInfo().catch(() => {});
    }
  });

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
    if (tabId != null) updatePageContextMenu(message.data.state);
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
      twpConfig.get('enableDiskCache') !== 'yes',
      dontSortResults,
    );
  });

  onMessage('openOptionsPage', () => {
    browser.runtime.openOptionsPage().catch(() => {});
  });

  onMessage('getCacheSize', () => translationCache.calculateSize());
  onMessage('deleteTranslationCache', (message) => translationCache.deleteAll(message.data?.reload));

  browser.action.onClicked.addListener((tab) => {
    if (!tab.id) return;
    toggleTranslationForTab(tab.id);
  });

  if (browser.contextMenus) {
    browser.contextMenus.onClicked.addListener((info, tab) => {
      if (!tab?.id) return;
      switch (info.menuItemId) {
        case CONTEXT_MENU_IDS.translatePage:
          toggleTranslationForTab(tab.id);
          break;
        case CONTEXT_MENU_IDS.translateRestoreThisFrame:
          void sendMessage('toggleTranslation', undefined, { tabId: tab.id, frameId: info.frameId }).catch(() => {});
          break;
        case CONTEXT_MENU_IDS.translateSelectedText:
          void sendMessage('TranslateSelectedText', undefined, tab.id).catch(() => {});
          break;
        case CONTEXT_MENU_IDS.showPopup:
          resetBrowserAction(true);
          if (browser.action.openPopup) {
            void browser.action
              .openPopup()
              .catch(() => {})
              .finally(() => resetBrowserAction());
          } else {
            resetBrowserAction();
          }
          break;
        case CONTEXT_MENU_IDS.neverTranslate:
          if (tab.url) {
            try {
              void twpConfig.addSiteToNeverTranslate(new URL(tab.url).hostname);
            } catch {
              // ignore unparseable tab URLs
            }
          }
          break;
        case CONTEXT_MENU_IDS.moreOptions:
          browser.runtime.openOptionsPage().catch(() => {});
          break;
      }
    });
  }

  browser.commands.onCommand.addListener((command, tab) => {
    const tabId = tab?.id;
    if (tabId == null) return;
    switch (command) {
      case 'hotkey-toggle-translation':
        toggleTranslationForTab(tabId);
        break;
      case 'hotkey-translate-selected-text':
        void sendMessage('TranslateSelectedText', undefined, tabId).catch(() => {});
        break;
      case 'hotkey-hot-translate-selected-text':
        void sendMessage('hotTranslateSelectedText', undefined, tabId).catch(() => {});
        break;
      case 'hotkey-swap-page-translation-service':
        // content-main.content.ts's handler does the actual
        // twpConfig.swapPageTranslationService() call + retranslate.
        void sendMessage('swapTranslationService', undefined, mainFrameTarget(tabId)).catch(() => {});
        break;
      case 'hotkey-show-original':
        void sendMessage('restorePage', undefined, pageActionTarget(tabId)).catch(() => {});
        break;
      case 'hotkey-translate-page-1':
      case 'hotkey-translate-page-2':
      case 'hotkey-translate-page-3': {
        const index = Number(command.slice(-1)) - 1;
        const lang = twpConfig.get('targetLanguages')[index];
        if (!lang) break;
        void twpConfig.setTargetLanguage(lang).then(() => {
          void sendMessage('translatePage', { targetLanguage: lang }, pageActionTarget(tabId)).catch(() => {});
        });
        break;
      }
    }
  });
});
