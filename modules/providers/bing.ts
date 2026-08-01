import { parseDocument } from 'htmlparser2';
import { Service, type ServiceSingleResult, type TranslationInfo, Utils } from './types';
import { XMLHttpRequestShim } from './xhrShim';

/**
 * TypeScript port of BingHelper + the `bingService` instance from
 * background/translationService.js. The response parser uses `htmlparser2`
 * (a real npm dependency here) instead of `DOMParser` — the old code's
 * service-worker port smuggled this same library in via a rebuilt
 * lib/polyfill.js webpack bundle exposing `globalThis.htmlparser2`, since
 * service workers have no DOMParser either. Now it's just a normal import.
 */

let lastRequestAuthTime: number | null = null;
let translateAuth: string | null = null;
let authNotFound = false;
let authPromise: Promise<void> | null = null;

async function findAuth(): Promise<void> {
  if (authPromise) return await authPromise;

  authPromise = new Promise<void>((resolve) => {
    let updateBingAuth = false;
    if (lastRequestAuthTime) {
      const date = new Date();
      if (translateAuth) {
        date.setMinutes(date.getMinutes() - 8);
      } else if (authNotFound) {
        date.setMinutes(date.getMinutes() - 5);
      } else {
        date.setMinutes(date.getMinutes() - 1);
      }
      if (date.getTime() > lastRequestAuthTime) updateBingAuth = true;
    } else {
      updateBingAuth = true;
    }

    if (!updateBingAuth) {
      resolve();
      return;
    }

    lastRequestAuthTime = Date.now();

    const http = new XMLHttpRequestShim();
    http.open('GET', 'https://edge.microsoft.com/translate/auth');
    http.send();
    http.onload = () => {
      if (http.responseText && http.responseText.length > 1) {
        translateAuth = http.responseText;
        authNotFound = false;
      } else {
        authNotFound = true;
      }
      resolve();
    };
    http.onerror =
      http.onabort =
      http.ontimeout =
        (e) => {
          console.error(e);
          resolve();
        };
  });

  authPromise.finally(() => {
    authPromise = null;
  });

  return await authPromise;
}

function cbTransformRequest(sourceArray: string[]): string {
  let id = 10;
  return sourceArray
    .map((value) => {
      const r = `<b${id}>${Utils.escapeHTML(value)}</b${id}>`;
      id++;
      return r;
    })
    .join('');
}

function cbParseResponse(
  response: Array<{ translations: Array<{ text: string }>; detectedLanguage?: { language: string } }>,
): ServiceSingleResult[] {
  return response.map((r) => ({
    text: r.translations[0]?.text ?? '',
    detectedLanguage: r.detectedLanguage?.language ?? null,
  }));
}

function cbTransformResponse(result: string, dontSortResults: boolean): string[] {
  const resultArray: string[] = [];

  const doc = parseDocument(result);
  let currText = '';
  doc.childNodes.forEach((node: any) => {
    if (dontSortResults) {
      if (node.type === 'text') {
        currText += node.data;
      } else {
        resultArray.push(currText + (node.children?.[0]?.data || ''));
        currText = '';
      }
    } else {
      if (node.type === 'text') {
        currText += node.data;
      } else {
        const id = parseInt(node.name.slice(1), 10) - 10;
        resultArray[id] = currText + (node.children?.[0]?.data || '');
        currText = '';
      }
    }
  });

  return resultArray;
}

function cbGetExtraParameters(sourceLanguage: string, targetLanguage: string): string {
  return `${sourceLanguage !== 'auto-detect' ? '&from=' + sourceLanguage : ''}&to=${targetLanguage}`;
}

function cbGetRequestBody(_sourceLanguage: string, _targetLanguage: string, requests: TranslationInfo[]): string {
  return JSON.stringify(requests.map((info) => ({ text: info.originalText })));
}

function cbGetExtraHeaders(): Array<{ name: string; value: string }> {
  return [
    { name: 'Content-Type', value: 'application/json' },
    { name: 'authorization', value: 'Bearer ' + (translateAuth ?? '') },
  ];
}

const BING_LANG_REPLACEMENTS: Array<{ search: string; replace: string }> = [
  { search: 'auto', replace: 'auto-detect' },
  { search: 'zh-CN', replace: 'zh-Hans' },
  { search: 'zh-TW', replace: 'zh-Hant' },
  { search: 'tl', replace: 'fil' },
  { search: 'hmn', replace: 'mww' },
  { search: 'ku', replace: 'kmr' },
  { search: 'ckb', replace: 'ku' },
  { search: 'mn', replace: 'mn-Cyrl' },
  { search: 'no', replace: 'nb' },
  { search: 'lg', replace: 'lug' },
  { search: 'sr', replace: 'sr-Cyrl' },
  { search: 'mni-Mtei', replace: 'mni' },
];

class BingService extends Service {
  constructor() {
    super(
      'bing',
      'https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0&includeSentenceLength=true',
      'POST',
      {
        cbTransformRequest,
        cbParseResponse,
        cbTransformResponse,
        cbGetExtraParameters,
        cbGetRequestBody,
        cbGetExtraHeaders,
      },
    );
  }

  override async translate(
    sourceLanguage: string,
    targetLanguage: string,
    sourceArray2d: string[][],
    dontSaveInPersistentCache = false,
    dontSortResults = false,
  ): Promise<string[][]> {
    for (const r of BING_LANG_REPLACEMENTS) {
      if (targetLanguage === r.search) targetLanguage = r.replace;
      if (sourceLanguage === r.search) sourceLanguage = r.replace;
    }

    await findAuth();
    if (!translateAuth) return [];

    return await super.translate(
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      dontSaveInPersistentCache,
      dontSortResults,
    );
  }
}

export const bingService = new BingService();
