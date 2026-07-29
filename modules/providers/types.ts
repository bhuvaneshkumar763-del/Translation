import { XMLHttpRequestShim } from './xhrShim';
import { translationCache } from '../cache/translationCache';

/**
 * TypeScript port of the shared `Service` base class + `Utils` from
 * background/translationService.js. Ported near-verbatim, including this
 * fork's own reliability engineering (retry/backoff, concurrency cap, the
 * job-scoped service-worker keepalive) — these are deliberate fixes for real
 * problems (transient failures, 429 storms, MV3 service-worker eviction
 * mid-batch), not incidental complexity to simplify away.
 */

export type TranslationStatus = 'complete' | 'translating' | 'error';

export interface TranslationInfo {
  originalText: string;
  translatedText: string | null;
  detectedLanguage: string | null;
  status: TranslationStatus;
  waitTranslate: Promise<void>;
}

export interface ServiceSingleResult {
  text: string;
  detectedLanguage: string | null;
}

export type XhrMethod = 'GET' | 'POST';

export interface ServiceCallbacks {
  cbTransformRequest(sourceArray: string[]): string;
  cbParseResponse(response: any): ServiceSingleResult[];
  cbTransformResponse(result: string, dontSortResults: boolean): string[];
  cbGetExtraParameters?(sourceLanguage: string, targetLanguage: string, requests: TranslationInfo[]): string;
  cbGetRequestBody?(sourceLanguage: string, targetLanguage: string, requests: TranslationInfo[]): string;
  cbGetExtraHeaders?(): Array<{ name: string; value: string }>;
}

export class Utils {
  /** & < > " ' -> entities. Bing's custom-dictionary <mstrans:...> tags are protected from escaping first. */
  static escapeHTML(unsafe: string): string {
    const bingMarkFrontPart = '<mstrans:dictionary translation="';
    const bingMarkSecondPart = '"></mstrans:dictionary>';

    let s = unsafe.replaceAll(bingMarkFrontPart, '@-/629^*').replaceAll(bingMarkSecondPart, '^$537+*');

    s = s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    s = s.replaceAll('@-/629^*', bingMarkFrontPart).replaceAll('^$537+*', bingMarkSecondPart);

    return s;
  }

  static unescapeHTML(unsafe: string): string {
    return unsafe
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }
}

/**
 * Job-scoped service-worker keepalive. MV3 evicts the background service
 * worker after ~30s idle, which can drop an in-flight batch mid-request on a
 * long page. Pings a cheap extension API on an interval ONLY while
 * translation work is actually in flight (refcounted acquire/release), so
 * there's no permanent wakelock/battery cost while just reading.
 */
export const swKeepAlive = (() => {
  let refs = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  const ping = () => {
    try {
      browser.runtime.getPlatformInfo();
    } catch {
      // ignore
    }
  };
  return {
    acquire() {
      refs++;
      if (timer === null) {
        ping();
        timer = setInterval(ping, 20000);
      }
    },
    release() {
      if (refs > 0) refs--;
      if (refs === 0 && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
})();

interface RetryableError extends Error {
  retryAfterMs?: number;
}

export class Service {
  readonly serviceName: string;
  baseURL: string;
  readonly xhrMethod: XhrMethod;
  readonly callbacks: ServiceCallbacks;

  /** In-memory dedupe: ensures two identical concurrent requests share one XHR. */
  private translationsInProgress = new Map<string, TranslationInfo>();

  constructor(serviceName: string, baseURL: string, xhrMethod: XhrMethod, callbacks: ServiceCallbacks) {
    this.serviceName = serviceName;
    this.baseURL = baseURL;
    this.xhrMethod = xhrMethod;
    this.callbacks = callbacks;
  }

  removeTranslationsWithError(): void {
    this.translationsInProgress.forEach((info, key) => {
      if (info.status === 'error') this.translationsInProgress.delete(key);
    });
  }

  /** https://github.com/FilipePS/Traduzir-paginas-web/issues/484 */
  private fixString(str: string): string {
    return str.replace(/​/g, ' ');
  }

  private async getRequests(
    sourceLanguage: string,
    targetLanguage: string,
    sourceArray2d: string[][],
  ): Promise<[TranslationInfo[][], TranslationInfo[]]> {
    const requests: TranslationInfo[][] = [];
    const currentTranslationsInProgress: TranslationInfo[] = [];

    let currentRequest: TranslationInfo[] = [];
    let currentSize = 0;

    for (const sourceArray of sourceArray2d) {
      const requestString = this.fixString(this.callbacks.cbTransformRequest(sourceArray));
      const requestHash = [sourceLanguage, targetLanguage, requestString].join(', ');

      const existing = this.translationsInProgress.get(requestHash);
      if (existing) {
        currentTranslationsInProgress.push(existing);
        continue;
      }

      let status: TranslationStatus = 'translating';
      let resolveWait!: () => void;
      const info: TranslationInfo = {
        originalText: requestString,
        translatedText: null,
        detectedLanguage: null,
        get status() {
          return status;
        },
        set status(next: TranslationStatus) {
          status = next;
          resolveWait();
        },
        waitTranslate: new Promise<void>((resolve) => (resolveWait = resolve)),
      };

      currentTranslationsInProgress.push(info);
      this.translationsInProgress.set(requestHash, info);

      const cacheEntry = await translationCache.get(this.serviceName, sourceLanguage, targetLanguage, requestString);
      if (cacheEntry) {
        info.translatedText = cacheEntry.translatedText;
        info.detectedLanguage = cacheEntry.detectedLanguage;
        info.status = 'complete';
      } else {
        currentRequest.push(info);
        currentSize += info.originalText.length;
        // 800 -> 1100: larger batches give the translator more surrounding
        // context (better accuracy) and cut round-trips, staying well under
        // each endpoint's limits.
        if (currentSize > 1100) {
          requests.push(currentRequest);
          currentSize = 0;
          currentRequest = [];
        }
      }
    }

    if (currentRequest.length > 0) requests.push(currentRequest);

    return [requests, currentTranslationsInProgress];
  }

  private async makeRequestOnce(sourceLanguage: string, targetLanguage: string, requests: TranslationInfo[]): Promise<any> {
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequestShim();
      xhr.open(
        this.xhrMethod,
        this.baseURL + (this.callbacks.cbGetExtraParameters?.(sourceLanguage, targetLanguage, requests) ?? ''),
      );

      this.callbacks.cbGetExtraHeaders?.().forEach((header) => {
        xhr.setRequestHeader(header.name, header.value);
      });

      xhr.responseType = 'json';
      // Bound each request so a hung connection doesn't stall a chunk
      // forever — it fails and the retry/backoff wrapper takes over.
      xhr.timeout = 20000;

      xhr.onload = () => {
        // Treat HTTP error statuses (429 rate-limit, 5xx) as failures so the
        // retry/backoff wrapper engages instead of passing a bad body on.
        const status = xhr.status;
        if (status && (status === 429 || status >= 500)) {
          const err: RetryableError = new Error(`HTTP ${status}`);
          const ra = parseFloat(xhr.getResponseHeader('retry-after') ?? '');
          if (ra > 0) err.retryAfterMs = Math.min(6000, ra * 1000);
          reject(err);
          return;
        }
        resolve(xhr.response);
      };
      xhr.onerror = xhr.onabort = xhr.ontimeout = (event) => {
        console.error(event);
        reject(new Error('XHR failed'));
      };

      xhr.send(this.callbacks.cbGetRequestBody?.(sourceLanguage, targetLanguage, requests));
    });
  }

  /** Retry with backoff: up to 3 attempts, 400ms/1200ms, honoring Retry-After (capped at 6s) when present. */
  private async makeRequest(sourceLanguage: string, targetLanguage: string, requests: TranslationInfo[]): Promise<any> {
    const maxAttempts = 3;
    let lastError: RetryableError | undefined;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        let delay = attempt === 1 ? 400 : 1200;
        if (lastError?.retryAfterMs && lastError.retryAfterMs > delay) delay = lastError.retryAfterMs;
        await new Promise((r) => setTimeout(r, delay));
      }
      try {
        return await this.makeRequestOnce(sourceLanguage, targetLanguage, requests);
      } catch (e) {
        lastError = e as RetryableError;
      }
    }
    throw lastError;
  }

  async translate(
    sourceLanguage: string,
    targetLanguage: string,
    sourceArray2d: string[][],
    dontSaveInPersistentCache = false,
    dontSortResults = false,
  ): Promise<string[][]> {
    const [requests, currentTranslationsInProgress] = await this.getRequests(sourceLanguage, targetLanguage, sourceArray2d);

    // Cap concurrent in-flight requests. Firing every chunk at once (full-page
    // mode can produce dozens) tends to trip rate limiters, which then forces
    // retries and makes the whole page slower and less reliable.
    const MAX_CONCURRENT = 6;
    let inFlight = 0;
    let cursor = 0;

    const handleRequest = async (request: TranslationInfo[]) => {
      try {
        const response = await this.makeRequest(sourceLanguage, targetLanguage, request);
        const results = this.callbacks.cbParseResponse(response);
        request.forEach((info, idx) => {
          const result = results[idx];
          info.detectedLanguage = result.detectedLanguage || 'und';
          info.translatedText = result.text;
          info.status = 'complete';

          if (!dontSaveInPersistentCache && info.translatedText) {
            translationCache.set(
              this.serviceName,
              sourceLanguage,
              targetLanguage,
              info.originalText,
              info.translatedText,
              info.detectedLanguage,
            );
          }
        });
      } catch (e) {
        console.error(e);
        request.forEach((info) => {
          info.status = 'error';
        });
      }
    };

    swKeepAlive.acquire();
    try {
      if (requests.length > 0) {
        await new Promise<void>((resolveAll) => {
          let completed = 0;
          const pump = () => {
            while (inFlight < MAX_CONCURRENT && cursor < requests.length) {
              const request = requests[cursor++];
              inFlight++;
              handleRequest(request).then(() => {
                inFlight--;
                completed++;
                if (completed === requests.length) resolveAll();
                else pump();
              });
            }
          };
          pump();
        });
      }

      await Promise.all(currentTranslationsInProgress.map((info) => info.waitTranslate));
    } finally {
      swKeepAlive.release();
    }

    return currentTranslationsInProgress.map((info) => this.callbacks.cbTransformResponse(info.translatedText ?? '', dontSortResults));
  }
}
