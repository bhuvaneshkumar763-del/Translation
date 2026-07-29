import { XMLHttpRequestShim } from './xhrShim';
import { Service, Utils, type ServiceSingleResult, type TranslationInfo } from './types';

/**
 * TypeScript port of YandexHelper + the `yandexService` instance from
 * background/translationService.js. Ported line-for-line — this is a
 * reverse-engineered, undocumented endpoint (the "sid" is scraped from
 * Yandex's own website-widget JS bundle).
 */

let lastRequestSidTime: number | null = null;
let translateSid: string | null = null;
let sidNotFound = false;
let findPromise: Promise<void> | null = null;

async function findSID(): Promise<void> {
  if (findPromise) return await findPromise;

  findPromise = new Promise<void>((resolve) => {
    let updateYandexSid = false;
    if (lastRequestSidTime) {
      const date = new Date();
      if (translateSid) {
        date.setMinutes(date.getMinutes() - 20);
      } else if (sidNotFound) {
        date.setMinutes(date.getMinutes() - 5);
      } else {
        date.setMinutes(date.getMinutes() - 1);
      }
      if (date.getTime() > lastRequestSidTime) updateYandexSid = true;
    } else {
      updateYandexSid = true;
    }

    if (!updateYandexSid) {
      resolve();
      return;
    }

    lastRequestSidTime = Date.now();

    const http = new XMLHttpRequestShim();
    http.open(
      'GET',
      'https://translate.yandex.net/website-widget/v1/widget.js?widgetId=ytWidget&pageLang=es&widgetTheme=light&autoMode=false',
    );
    http.send();
    http.onload = () => {
      const result = (http.responseText ?? '').match(/sid:\s'[0-9a-f.]+/);
      if (result && result[0] && result[0].length > 7) {
        translateSid = result[0].substring(6);
        sidNotFound = false;
      } else {
        sidNotFound = true;
      }
      resolve();
    };
    http.onerror = http.onabort = http.ontimeout = (e) => {
      console.error(e);
      resolve();
    };
  });

  findPromise.finally(() => {
    findPromise = null;
  });

  return await findPromise;
}

function cbTransformRequest(sourceArray: string[]): string {
  return sourceArray.map((value) => Utils.escapeHTML(value)).join('<wbr>');
}

function cbParseResponse(response: { lang?: string; text: string[] }): ServiceSingleResult[] {
  const detectedLanguage = response.lang ? response.lang.split('-')[0] : null;
  return response.text.map((text) => ({ text, detectedLanguage }));
}

function cbTransformResponse(result: string): string[] {
  return result.split('<wbr>').map((value) => Utils.unescapeHTML(value));
}

function cbGetExtraParameters(sourceLanguage: string, targetLanguage: string, requests: TranslationInfo[]): string {
  return `&id=${translateSid}-0-0&format=html&lang=${sourceLanguage === 'auto' ? '' : sourceLanguage + '-'}${targetLanguage}${requests
    .map((info) => `&text=${encodeURIComponent(info.originalText)}`)
    .join('')}`;
}

function cbGetExtraHeaders(): Array<{ name: string; value: string }> {
  return [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }];
}

const YANDEX_LANG_REPLACEMENTS: Array<{ search: string; replace: string }> = [
  { search: 'zh-CN', replace: 'zh' },
  { search: 'zh-TW', replace: 'zh' },
  { search: 'fr-CA', replace: 'fr' },
  { search: 'pt', replace: 'pt-BR' },
  { search: 'pt-PT', replace: 'pt' },
];

class YandexService extends Service {
  constructor() {
    super('yandex', 'https://translate.yandex.net/api/v1/tr.json/translate?srv=tr-url-widget', 'GET', {
      cbTransformRequest,
      cbParseResponse,
      cbTransformResponse,
      cbGetExtraParameters,
      cbGetRequestBody: () => undefined,
      cbGetExtraHeaders,
    });
  }

  override async translate(
    sourceLanguage: string,
    targetLanguage: string,
    sourceArray2d: string[][],
    dontSaveInPersistentCache = false,
    dontSortResults = false,
  ): Promise<string[][]> {
    await findSID();
    if (!translateSid) return [];

    for (const r of YANDEX_LANG_REPLACEMENTS) {
      if (targetLanguage === r.search) targetLanguage = r.replace;
      if (sourceLanguage === r.search) sourceLanguage = r.replace;
    }

    return await super.translate(sourceLanguage, targetLanguage, sourceArray2d, dontSaveInPersistentCache, dontSortResults);
  }
}

export const yandexService = new YandexService();
