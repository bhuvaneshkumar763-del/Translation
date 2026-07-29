import { Service, type TranslationInfo } from './types';

/**
 * TypeScript port of `createLibreService` from background/translationService.js
 * — a user-configured self-hosted/third-party LibreTranslate instance (URL +
 * API key both supplied via options). Unlike the built-in providers, only a
 * single string is ever translated per request (`sourceArray2d[0][0]`).
 */
export function createLibreService(url: string, apiKey: string): Service {
  return new (class extends Service {
    constructor() {
      super('libre', url, 'POST', {
        cbTransformRequest: (sourceArray) => sourceArray[0],
        cbParseResponse: (response: { translatedText: string; detectedLanguage: { language: string } }) => [
          { text: response.translatedText, detectedLanguage: response.detectedLanguage.language },
        ],
        cbTransformResponse: (result) => [result],
        cbGetRequestBody: (sourceLanguage: string, targetLanguage: string, requests: TranslationInfo[]) => {
          const params = new URLSearchParams();
          params.append('q', requests[0].originalText);
          params.append('source', sourceLanguage);
          params.append('target', targetLanguage);
          params.append('format', 'text');
          params.append('api_key', apiKey);
          return params.toString();
        },
        cbGetExtraHeaders: () => [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
      });
    }
  })();
}
