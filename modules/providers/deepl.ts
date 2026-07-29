import type { Browser } from 'wxt/browser';
import { Service, type TranslationProvider } from './types';
import { onMessage, sendMessage } from '../messaging/protocol';

/**
 * TypeScript port of the DeepL integrations from background/translationService.js.
 * DeepL has two distinct modes, ported separately:
 *
 * 1. Default ("deepl") — no API key, drives a real (hidden-ish) deepl.com
 *    tab: opens/reuses a tab at a URL encoding the source text, and a
 *    content script running ON that tab (entrypoints/content-deepl-bridge —
 *    Phase 3, ported alongside this) reads DeepL's own translation result
 *    out of the page and relays it back via the `DeepL_firstTranslationResult`
 *    message. This is browser automation of deepl.com's own frontend, not a
 *    backend API call — deliberately kept that way, not reimplemented as a
 *    fake API client.
 * 2. Free API ("deepl_freeapi", createDeeplFreeApiService below) — a real
 *    Service subclass hitting DeepL's actual REST API with a user-supplied
 *    key.
 */

type Tab = Browser.tabs.Tab;

async function tabsCreate(url: string): Promise<Tab> {
  const userAgent = navigator.userAgent;
  const isMobile = /Android|BlackBerry|iPhone|iPad|iPod|Opera Mini|IEMobile|WPDesktop/i.test(userAgent);

  if (isMobile) {
    return await browser.tabs.create({ url });
  }
  const [activeTab] = await browser.tabs.query({ active: true, currentWindow: true });
  return await browser.tabs.create({ url, openerTabId: activeTab?.id });
}

class DeepLBridgeService implements TranslationProvider {
  private deeplTab: Tab | null = null;

  private waitFirstTranslationResult(): Promise<string> {
    return new Promise((resolve) => {
      const removeListener = onMessage('DeepL_firstTranslationResult', (message) => {
        resolve(message.data.result);
        removeListener();
      });
      setTimeout(() => {
        removeListener();
        resolve('');
      }, 8000);
    });
  }

  async translate(
    _sourceLanguage: string,
    targetLanguage: string,
    sourceArray2d: string[][],
  ): Promise<string[][]> {
    if (targetLanguage === 'pt') targetLanguage = 'pt-BR';
    else if (targetLanguage === 'no') targetLanguage = 'nb';
    else if (targetLanguage === 'zh-CN') targetLanguage = 'zh-Hans';
    else if (targetLanguage === 'zh-TW') targetLanguage = 'zh';

    const text = sourceArray2d[0][0];

    if (this.deeplTab?.id) {
      const existing = await browser.tabs.get(this.deeplTab.id).catch(() => null);
      if (existing?.id != null) {
        const response = await sendMessage('translateTextWithDeepL', { text, targetLanguage }, { tabId: existing.id, frameId: 0 }).catch(
          () => '',
        );
        return [[response]];
      }
    }

    this.deeplTab = await tabsCreate(`https://www.deepl.com/#!${targetLanguage}!#${encodeURIComponent(text)}`);
    const result = await this.waitFirstTranslationResult();
    return [[result]];
  }
}

export const deeplService = new DeepLBridgeService();

/** DeepL's real REST API, used when the user supplies their own API key (options page). */
export function createDeeplFreeApiService(apiKey: string): Service {
  return new (class extends Service {
    constructor() {
      super('deepl', 'https://api-free.deepl.com/v2/translate', 'POST', {
        cbTransformRequest: (sourceArray) => sourceArray[0],
        cbParseResponse: (response: { translations: Array<{ text: string; detected_source_language: string }> }) => [
          { text: response.translations[0].text, detectedLanguage: response.translations[0].detected_source_language },
        ],
        cbTransformResponse: (result) => [result],
        cbGetRequestBody: (sourceLanguage, targetLanguage, requests) => {
          const params = new URLSearchParams();
          params.append('text', requests[0].originalText);
          if (targetLanguage === 'pt') targetLanguage = 'pt-BR';
          else if (targetLanguage === 'no') targetLanguage = 'nb';
          else if (targetLanguage.startsWith('zh-')) targetLanguage = 'zh';
          else if (targetLanguage.startsWith('fr-')) targetLanguage = 'fr';
          params.append('target_lang', targetLanguage);
          return params.toString();
        },
        cbGetExtraHeaders: () => [
          { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
          { name: 'Authorization', value: 'DeepL-Auth-Key ' + apiKey },
        ],
      });
    }
  })();
}
