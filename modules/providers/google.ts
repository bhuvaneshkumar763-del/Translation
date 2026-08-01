import { Service, type ServiceSingleResult, type TranslationInfo, Utils } from './types';
import { XMLHttpRequestShim } from './xhrShim';

/**
 * TypeScript port of GoogleHelper_v2 + the `googleService` instance from
 * background/translationService.js. Ported line-for-line where it matters —
 * this is a reverse-engineered, undocumented endpoint, so behavior (the
 * `<pre><a i=N>` marker scheme, the auth-key scrape, the hardcoded fallback
 * key) is preserved exactly rather than "cleaned up".
 */

let lastRequestAuthTime: number | null = null;
let translateAuth: string | null = null;
let authNotFound = false;
let authPromise: Promise<void> | null = null;

async function findAuth(): Promise<void> {
  if (authPromise) return await authPromise;

  authPromise = new Promise<void>((resolve) => {
    let updateGoogleAuth = false;
    if (lastRequestAuthTime) {
      const date = new Date();
      if (translateAuth) {
        date.setMinutes(date.getMinutes() - 20);
      } else if (authNotFound) {
        date.setMinutes(date.getMinutes() - 5);
      } else {
        date.setMinutes(date.getMinutes() - 1);
      }
      if (date.getTime() > lastRequestAuthTime) updateGoogleAuth = true;
    } else {
      updateGoogleAuth = true;
    }

    if (!updateGoogleAuth) {
      resolve();
      return;
    }

    lastRequestAuthTime = Date.now();

    // Hardcoded fallback API key, used if the live scrape below fails.
    const alternativeKey = new TextDecoder().decode(
      new Uint8Array([
        65, 73, 122, 97, 83, 121, 65, 84, 66, 88, 97, 106, 118, 122, 81, 76, 84, 68, 72, 69, 81, 98, 99, 112, 113, 48,
        73, 104, 101, 48, 118, 87, 68, 72, 109, 79, 53, 50, 48,
      ]),
    );

    const http = new XMLHttpRequestShim();
    http.open(
      'GET',
      'https://translate.googleapis.com/_/translate_http/_/js/k=translate_http.tr.en_US.YusFYy3P_ro.O/am=AAg/d=1/exm=el_conf/ed=1/rs=AN8SPfq1Hb8iJRleQqQc8zhdzXmF9E56eQ/m=el_main',
    );
    http.send();
    http.onload = () => {
      if (http.responseText && http.responseText.length > 1) {
        const result = http.responseText.match(/['"]x-goog-api-key['"]\s*:\s*['"](\w{39})['"]/i);
        if (result && result.length === 2) {
          translateAuth = result[1] ?? alternativeKey;
          authNotFound = false;
        } else {
          authNotFound = true;
          translateAuth = alternativeKey;
        }
      } else {
        authNotFound = true;
        translateAuth = alternativeKey;
      }
      resolve();
    };
    http.onerror =
      http.onabort =
      http.ontimeout =
        (e) => {
          console.error(e);
          translateAuth = alternativeKey;
          resolve();
        };
  });

  authPromise.finally(() => {
    authPromise = null;
  });

  return await authPromise;
}

function cbTransformRequest(sourceArray: string[]): string {
  let arr = sourceArray.map((text) => Utils.escapeHTML(text));
  if (arr.length > 1) {
    arr = arr.map((text, index) => `<a i=${index}>${text}</a>`);
  }
  // the <pre> tag preserves text formatting
  return `<pre>${arr.join('')}</pre>`;
}

function cbParseResponse(response: [string[], (string | null)[] | undefined]): ServiceSingleResult[] {
  return response[0].map((value, index) => ({
    text: value,
    detectedLanguage: response[1]?.[index] ?? null,
  }));
}

function cbTransformResponse(result: string, dontSortResults: boolean): string[] {
  // remove the <pre> tag from the response
  if (result.indexOf('<pre') !== -1) {
    result = result.replace('</pre>', '');
    const index = result.indexOf('>');
    result = result.slice(index + 1);
  }

  const sentences: string[] = []; // each translated sentence is inside a <b> tag

  // Keep only the <a> tags — remove the original text repeated inside <i> tags.
  let idx = 0;
  while (true) {
    const sentenceStartIndex = result.indexOf('<b>', idx);
    if (sentenceStartIndex === -1) break;

    const sentenceFinalIndex = result.indexOf('<i>', sentenceStartIndex);
    if (sentenceFinalIndex === -1) {
      sentences.push(result.slice(sentenceStartIndex + 3));
      break;
    } else {
      sentences.push(result.slice(sentenceStartIndex + 3, sentenceFinalIndex));
    }
    idx = sentenceFinalIndex;
  }

  // Maybe the response has no <i>/<b> tags at all — just use the result.
  result = sentences.length > 0 ? sentences.join(' ') : result;
  result = result.replace(/<\/b>/g, '');

  // Capture each <a i={number}> and the text inside/around it. The same
  // index may appear multiple times; text outside any <a> tag gets folded
  // into the nearest preceding one. See
  // https://github.com/FilipePS/Traduzir-paginas-web/issues/449
  let resultArray: string[] = [];
  let lastEndPos = 0;
  for (const r of result.matchAll(/(<a\si=[0-9]+>)([^<>]*(?=<\/a>))*/g)) {
    const fullText = r[0];
    const fullLength = r[0].length;
    const pos = r.index ?? 0;
    if (pos > lastEndPos) {
      const aTag = r[1];
      const insideText = r[2] || '';
      const outsideText = result.slice(lastEndPos, pos).replace(/<\/a>/g, '');
      resultArray.push(aTag + outsideText + insideText);
    } else {
      resultArray.push(fullText);
    }
    lastEndPos = pos + fullLength;
  }

  {
    const lastOutsideText = result.slice(lastEndPos).replace(/<\/a>/g, '');
    if (resultArray.length > 0) {
      resultArray[resultArray.length - 1] += lastOutsideText;
    }
  }

  let indexes: number[];
  if (resultArray.length > 0) {
    indexes = resultArray
      .map((value) => parseInt(value.match(/[0-9]+(?=>)/g)?.[0] ?? '', 10))
      .filter((value) => !Number.isNaN(value));
    resultArray = resultArray.map((value) => value.slice(value.indexOf('>') + 1));
  } else {
    // No <a i={number}> in the response at all.
    resultArray = [result];
    indexes = [0];
  }

  resultArray = resultArray.map((value) => Utils.unescapeHTML(value));

  if (dontSortResults) {
    // https://github.com/FilipePS/Traduzir-paginas-web/issues/163 — don't
    // sort by <a i={number}>, just join the texts in response order.
    return resultArray;
  }

  // Sort by <a i={number}> so links keep the correct name — the markers can
  // also disappear/merge, hence the "reuses an index" handling above.
  const finalResultArray: string[] = [];
  indexes.forEach((targetIndex, j) => {
    finalResultArray[targetIndex] = finalResultArray[targetIndex]
      ? `${finalResultArray[targetIndex]} ${resultArray[j] ?? ''}`
      : (resultArray[j] ?? '');
  });
  return finalResultArray;
}

function cbGetRequestBody(sourceLanguage: string, targetLanguage: string, requests: TranslationInfo[]): string {
  return JSON.stringify([[requests.map((info) => info.originalText), sourceLanguage, targetLanguage], 'te']);
}

function cbGetExtraHeaders(): Array<{ name: string; value: string }> {
  return [
    { name: 'Content-Type', value: 'application/application/json+protobuf' },
    { name: 'X-goog-api-key', value: translateAuth ?? '' },
  ];
}

class GoogleService extends Service {
  constructor() {
    super('google', 'https://translate-pa.googleapis.com/v1/translateHtml', 'POST', {
      cbTransformRequest,
      cbParseResponse,
      cbTransformResponse,
      cbGetExtraParameters: () => '',
      cbGetRequestBody,
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
    // "prs" (Google's Dari/Afghan Persian code) maps to the standard fa-AF tag.
    if (targetLanguage === 'prs') targetLanguage = 'fa-AF';
    if (sourceLanguage === 'prs') sourceLanguage = 'fa-AF';

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

export const googleService = new GoogleService();
