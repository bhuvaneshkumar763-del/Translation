import type { Config } from '../config/schema';
import { twpConfig } from '../config/store';
import { bingService } from './bing';
import { builtinService } from './builtin';
import { createDeeplFreeApiService, deeplService } from './deepl';
import { getProviderDescriptor } from './descriptors';
import { googleService } from './google';
import { createLibreService } from './libre';
import { createLlmService } from './llm';
import type { TranslationProvider } from './types';
import { yandexService } from './yandex';

/**
 * All translation providers. `getSafeServiceByName` mirrors the old code's
 * gating: a service is only usable if it's in `enabledServices` (the
 * built-in 4) or registered as a `customServices` entry (libre/deepl_freeapi/
 * llm) — ported from `getSafeServiceByName` in background/translationService.js
 * — or, for a feature-detected provider like `builtin`, if it's actually
 * present in this browser (see `descriptors.ts`). Provider *capability*
 * metadata (roles, whether a key is required, feature-detection) lives in
 * `descriptors.ts`; this file is just wiring + config-driven instantiation.
 */
export const serviceList = new Map<string, TranslationProvider>([
  ['google', googleService],
  ['bing', bingService],
  ['yandex', yandexService],
  ['deepl', deeplService],
  ['builtin', builtinService],
]);

function getSafeServiceByName(serviceName: string): TranslationProvider | null {
  const descriptor = getProviderDescriptor(serviceName);
  if (descriptor?.isAvailable && !descriptor.isAvailable()) return null;

  // Feature-detected providers (currently just `builtin`) are gated purely
  // on that check above — they're not part of the enabledServices checkbox
  // list or customServices (no key to configure), so skip the rest.
  if (descriptor?.isAvailable) return serviceList.get(serviceName) ?? null;

  const enabled = twpConfig.get('enabledServices').includes(serviceName);
  const isCustom = twpConfig.get('customServices').some((cs) => cs.name === serviceName);
  if (!enabled && !isCustom) return null;
  return serviceList.get(serviceName) ?? null;
}

/** Register libre/deepl_freeapi/llm from config on startup, and keep Google's proxy override + custom services in sync as the options page edits them. */
export function initProviderRegistry(): void {
  twpConfig.onReady(() => {
    applyCustomServices(twpConfig.get('customServices'));
    applyGoogleProxy(twpConfig.get('proxyServers'));
  });

  twpConfig.onChanged((name, newValue) => {
    if (name === 'proxyServers') {
      applyGoogleProxy(newValue as Config['proxyServers']);
    } else if (name === 'customServices') {
      applyCustomServices(newValue as Config['customServices']);
    }
  });
}

function applyCustomServices(customServices: Config['customServices']): void {
  const libre = customServices.find((cs) => cs.name === 'libre');
  if (libre && 'url' in libre) {
    serviceList.set('libre', createLibreService(libre.url, libre.apiKey));
  } else {
    serviceList.delete('libre');
  }

  const deeplFreeApi = customServices.find((cs) => cs.name === 'deepl_freeapi');
  if (deeplFreeApi) {
    serviceList.set('deepl', createDeeplFreeApiService(deeplFreeApi.apiKey));
  } else {
    serviceList.set('deepl', deeplService);
  }

  const llm = customServices.find((cs) => cs.name === 'llm');
  if (llm && 'baseUrl' in llm) {
    serviceList.set('llm', createLlmService(llm.baseUrl, llm.apiKey, llm.model));
  } else {
    serviceList.delete('llm');
  }
}

function applyGoogleProxy(proxyServers: Config['proxyServers']): void {
  const url = new URL(googleService.baseURL);
  url.host = proxyServers?.google?.translateServer || 'translate-pa.googleapis.com';
  googleService.baseURL = url.toString();
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
    const service = getSafeServiceByName(serviceName);
    if (!service) return [];
    return await service.translate(
      sourceLanguage,
      targetLanguage,
      sourceArray2d,
      dontSaveInPersistentCache,
      dontSortResults,
    );
  },

  async translateText(
    serviceName: string,
    sourceLanguage: string,
    targetLanguage: string,
    sourceArray: string[],
    dontSaveInPersistentCache = false,
  ): Promise<string[]> {
    const service = getSafeServiceByName(serviceName);
    if (!service) return [];
    const results = await service.translate(
      sourceLanguage,
      targetLanguage,
      sourceArray.map((text) => [text]),
      dontSaveInPersistentCache,
    );
    return results.map((result) => result[0] ?? '');
  },

  async translateSingleText(
    serviceName: string,
    sourceLanguage: string,
    targetLanguage: string,
    originalText: string,
    dontSaveInPersistentCache = false,
  ): Promise<string | undefined> {
    const service = getSafeServiceByName(serviceName);
    if (!service) return undefined;
    const results = await service.translate(
      sourceLanguage,
      targetLanguage,
      [[originalText]],
      dontSaveInPersistentCache,
    );
    return results[0]?.[0];
  },

  removeTranslationsWithError(): void {
    serviceList.forEach((service) => {
      service.removeTranslationsWithError?.();
    });
  },
};
