import { twpConfig } from '@/modules/config/store';
import { onMessage } from '@/modules/messaging/protocol';
import { createPageTranslator } from '@/modules/page-translator/translateLoop';

/**
 * The page-translation content script — wires modules/page-translator's
 * engine (dedupe + mutation watching + adaptive resweep, ported from the old
 * contentScript/pageTranslator.js's hardening work) up to config and the
 * background message router. See translateLoop.ts for the fidelity note on
 * what's simplified in this phase (individual text nodes, not paragraph-
 * level "pieces"; no attribute/title/dictionary translation yet).
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  allFrames: true,
  matchAboutBlank: true,
  async main() {
    await twpConfig.onReady();

    const pageTranslator = createPageTranslator({
      getService: () => twpConfig.get('pageTranslatorService'),
      getSourceLanguage: () => 'auto',
    });

    onMessage('getCurrentPageLanguageState', () => pageTranslator.getState());
    onMessage('translatePage', async (message) => {
      const targetLanguage = message.data?.targetLanguage ?? twpConfig.get('targetLanguage') ?? 'en';
      await pageTranslator.translatePage(targetLanguage);
    });
    onMessage('restorePage', () => {
      pageTranslator.restorePage();
    });
  },
});
