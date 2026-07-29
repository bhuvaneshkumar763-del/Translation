import { googleService } from './google';
import type { Service } from './types';

/**
 * Phase 1: Google only. Bing and Yandex join in Phase 2 (they share the
 * page-translation code path, which is what validates the Service base class
 * is genuinely provider-agnostic); DeepL and LibreTranslate join in Phase 3.
 * `twpLang.getAlternativeService`'s cross-provider language-support fallback
 * isn't meaningful with a single provider, so it isn't ported yet either —
 * see modules/languages/index.ts.
 */
export const serviceList = new Map<string, Service>([['google', googleService]]);

export function getServiceByName(serviceName: string): Service | null {
  return serviceList.get(serviceName) ?? null;
}

export const translationService = {
  async translateHTML(
    serviceName: string,
    sourceLanguage: string,
    targetLanguage: string,
    sourceArray2d: string[][],
    dontSaveInPersistentCache = false,
    dontSortResults = false,
  ): Promise<string[][]> {
    const service = getServiceByName(serviceName);
    if (!service) return [];
    return await service.translate(sourceLanguage, targetLanguage, sourceArray2d, dontSaveInPersistentCache, dontSortResults);
  },

  async translateText(
    serviceName: string,
    sourceLanguage: string,
    targetLanguage: string,
    sourceArray: string[],
    dontSaveInPersistentCache = false,
  ): Promise<string[]> {
    const service = getServiceByName(serviceName);
    if (!service) return [];
    const results = await service.translate(
      sourceLanguage,
      targetLanguage,
      sourceArray.map((text) => [text]),
      dontSaveInPersistentCache,
    );
    return results.map((result) => result[0]);
  },

  async translateSingleText(
    serviceName: string,
    sourceLanguage: string,
    targetLanguage: string,
    originalText: string,
    dontSaveInPersistentCache = false,
  ): Promise<string | undefined> {
    const service = getServiceByName(serviceName);
    if (!service) return undefined;
    const results = await service.translate(sourceLanguage, targetLanguage, [[originalText]], dontSaveInPersistentCache);
    return results[0]?.[0];
  },

  removeTranslationsWithError(): void {
    serviceList.forEach((service) => service.removeTranslationsWithError());
  },
};
