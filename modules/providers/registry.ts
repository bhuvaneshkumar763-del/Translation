import { googleService } from './google';
import { bingService } from './bing';
import { yandexService } from './yandex';
import type { Service } from './types';

/**
 * Google, Bing, and Yandex — the 3 page-translation-capable providers.
 * DeepL and LibreTranslate join in Phase 3 (text-translation only, plus
 * DeepL's unusual live-tab-bridge architecture). `twpLang.getAlternativeService`'s
 * cross-provider language-support fallback isn't ported yet either — see
 * modules/languages/index.ts; it becomes meaningful once there's more than
 * one provider to fall back *to* for page translation, which is now, but
 * it's still deferred to keep this phase scoped to "providers work."
 */
export const serviceList = new Map<string, Service>([
  ['google', googleService],
  ['bing', bingService],
  ['yandex', yandexService],
]);

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
