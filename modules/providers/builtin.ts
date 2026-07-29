import { translationCache } from '../cache/translationCache';
import type { TranslationProvider } from './types';

/**
 * On-device translation via Chrome's built-in Translator API (stable since
 * Chrome 138, no origin trial needed — verify against
 * https://developer.chrome.com/docs/ai/translator-api if this drifts, that
 * page is the source of truth, not this comment). Zero-config: no API key,
 * no network call, model downloaded locally by the browser itself the first
 * time a language pair is used. Feature-detected via
 * `descriptors.ts`'s `isAvailable` — this file is simply unreachable (never
 * added to `registry.ts`'s active dispatch) on Firefox or older Chrome.
 *
 * A duck-typed `TranslationProvider`, not a `Service` subclass — there's no
 * XHR/retry/concurrency to reuse here (no network round-trip at all), and
 * the Translator API has its own async instance-creation lifecycle that
 * doesn't map onto `Service`'s XHR-batch shape. Deliberately no
 * `translateLoop.ts` batching hint (see `descriptors.ts`): on-device calls
 * have no round-trip to amortize, so per-node granularity is already fine.
 */

interface BuiltinTranslatorInstance {
  translate(text: string): Promise<string>;
  destroy?(): void;
}

type TranslatorAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface BuiltinTranslatorStatic {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<TranslatorAvailability>;
  create(options: { sourceLanguage: string; targetLanguage: string }): Promise<BuiltinTranslatorInstance>;
}

declare global {
  // Not yet in TypeScript's DOM lib — minimal ambient declaration covering
  // only what this file uses. See the header comment for the source of truth.
  var Translator: BuiltinTranslatorStatic | undefined;
}

// One Translator instance per language pair, reused across calls — creating
// one is async and may involve a model download on first use per pair.
const translatorsByLanguagePair = new Map<string, Promise<BuiltinTranslatorInstance>>();

function getTranslator(sourceLanguage: string, targetLanguage: string): Promise<BuiltinTranslatorInstance> {
  const key = `${sourceLanguage}:${targetLanguage}`;
  let translator = translatorsByLanguagePair.get(key);
  if (!translator) {
    translator = Translator!.create({ sourceLanguage, targetLanguage });
    translatorsByLanguagePair.set(key, translator);
    // If creation itself fails (e.g. this specific pair turns out to be
    // unsupported despite availability() saying otherwise), don't leave a
    // rejected promise cached forever — let the next call retry.
    translator.catch(() => translatorsByLanguagePair.delete(key));
  }
  return translator;
}

async function translateOne(
  translator: BuiltinTranslatorInstance,
  sourceLanguage: string,
  targetLanguage: string,
  text: string,
  dontSaveInPersistentCache: boolean,
): Promise<string> {
  if (!dontSaveInPersistentCache) {
    const cached = await translationCache.get('builtin', sourceLanguage, targetLanguage, text);
    if (cached) return cached.translatedText;
  }
  try {
    const translated = await translator.translate(text);
    if (!dontSaveInPersistentCache) {
      translationCache.set('builtin', sourceLanguage, targetLanguage, text, translated, sourceLanguage);
    }
    return translated;
  } catch (e) {
    console.error('builtin provider: translate failed', e);
    return '';
  }
}

export const builtinService: TranslationProvider = {
  async translate(
    sourceLanguage: string,
    targetLanguage: string,
    sourceArray2d: string[][],
    dontSaveInPersistentCache = false,
  ): Promise<string[][]> {
    if (typeof Translator === 'undefined') return sourceArray2d.map(() => []);

    const availability = await Translator.availability({ sourceLanguage, targetLanguage }).catch(
      () => 'unavailable' as const,
    );
    if (availability === 'unavailable') return sourceArray2d.map(() => []);

    let translator: BuiltinTranslatorInstance;
    try {
      translator = await getTranslator(sourceLanguage, targetLanguage);
    } catch (e) {
      console.error('builtin provider: failed to create translator', e);
      return sourceArray2d.map(() => []);
    }

    return await Promise.all(
      sourceArray2d.map((pieces) =>
        Promise.all(
          pieces.map((text) =>
            translateOne(translator, sourceLanguage, targetLanguage, text, dontSaveInPersistentCache),
          ),
        ),
      ),
    );
  },
};
