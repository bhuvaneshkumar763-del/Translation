import { fixTLanguageCode } from '../languages';
import { sendMessage } from '../messaging/protocol';

/**
 * Detects the page's original (source) language and decides whether to
 * auto-translate on load. Ported from the "original tab language" detection
 * + auto-translate-on-load block in the old contentScript/pageTranslator.js
 * (around its `detectTabLanguage` background round-trip), simplified in two
 * ways:
 *
 * - Detection itself now runs directly in the main frame via
 *   `browser.i18n.detectLanguage()` against the page's own text, instead of
 *   bouncing through the background for `chrome.tabs.detectLanguage` (which
 *   doesn't work on mobile/Opera, hence the old code's platform-branching
 *   dance between that and a content-script "detect from innerText"
 *   fallback). `i18n.detectLanguage` works the same everywhere, so that
 *   branching is gone — not a scope cut, a genuine simplification.
 * - The old code also carved out a few hostnames specific to the upstream
 *   project's own hosted services (pdf.translatewebpages.org and friends).
 *   Those aren't ported — they're that project's own webapp, not general
 *   behavior. The carve-out for well-known *third-party* translation output
 *   pages (Google/Yandex/DeepL's own translate-result pages), which matters
 *   generally to avoid confusing recursive-translation UX, is kept.
 */

const TRANSLATION_SERVICE_HOSTS = new Set([
  'translate.googleusercontent.com',
  'translate.google.com',
  'translate.yandex.com',
  'www.deepl.com',
  'translated.turbopages.org',
]);

function isTranslationServiceHost(hostname: string): boolean {
  return TRANSLATION_SERVICE_HOSTS.has(hostname) || hostname.endsWith('translate.goog');
}

async function waitUntilVisible(): Promise<void> {
  if (document.visibilityState === 'visible') return;
  await new Promise<void>((resolve) => {
    const handler = () => {
      if (document.visibilityState === 'visible') {
        document.removeEventListener('visibilitychange', handler);
        resolve();
      }
    };
    document.addEventListener('visibilitychange', handler);
  });
}

async function detectFromPageText(): Promise<string> {
  const sample = (document.body?.innerText ?? '').slice(0, 4000).trim();
  if (!sample || !browser.i18n.detectLanguage) return 'und';
  const result = await browser.i18n.detectLanguage(sample);
  const top = result?.languages?.[0]?.language;
  if (!top) return 'und';
  return fixTLanguageCode(top) ?? 'und';
}

export function createOriginalLanguageTracker() {
  let language = 'und';
  const listeners = new Set<(lang: string) => void>();

  function setLanguage(next: string): void {
    if (next === language) return;
    language = next;
    listeners.forEach((cb) => cb(next));
  }

  async function start(): Promise<void> {
    if (window.self === window.top) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      await waitUntilVisible();
      const detected = await detectFromPageText();
      setLanguage(detected);
      void sendMessage('reportMainFrameTabLanguage', { language: detected });
    } else {
      const detected = await sendMessage('getMainFrameTabLanguage', undefined).catch(() => 'und' as const);
      setLanguage(detected);
    }
  }

  return {
    start,
    get: () => language,
    onChange(cb: (lang: string) => void): () => void {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}

export interface AutoTranslateDecisionInput {
  originalLanguage: string;
  hostname: string;
  targetLanguage: string;
  pageLanguageState: 'original' | 'translated';
  alwaysTranslateSites: string[];
  neverTranslateSites: string[];
  alwaysTranslateLangs: string[];
  neverTranslateLangs: string[];
  hasSavedSourceLangForHost: boolean;
  isIncognito: boolean;
}

/**
 * Whether the page should be auto-translated once the original language is
 * known. A saved per-host source language (set via the bubble's "From"
 * picker or Improve Translation) or an explicit "always translate this site"
 * are honored unconditionally — the user already told us what this site is,
 * so that's just as explicit a signal as a language match.
 */
export function shouldAutoTranslateOnLoad(input: AutoTranslateDecisionInput): boolean {
  if (input.pageLanguageState !== 'original') return false;
  if (input.isIncognito) return false;
  if (input.neverTranslateSites.includes(input.hostname)) return false;
  if (isTranslationServiceHost(input.hostname)) return false;

  const alwaysSite = input.alwaysTranslateSites.includes(input.hostname);
  if (alwaysSite || input.hasSavedSourceLangForHost) return true;

  if (input.originalLanguage === 'und') return false;
  if (input.originalLanguage === input.targetLanguage) return false;
  if (input.neverTranslateLangs.includes(input.originalLanguage)) return false;
  if (input.alwaysTranslateLangs.includes(input.originalLanguage)) return true;

  return false;
}
