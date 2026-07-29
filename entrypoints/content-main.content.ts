import { twpConfig } from '@/modules/config/store';
import { onMessage, sendMessage } from '@/modules/messaging/protocol';

/**
 * Phase 1 bare-bones page translator — proves the Google provider works
 * end to end (walk the DOM, batch text through translateHTML, splice
 * results back in, restore on demand). Deliberately naive: no dedupe
 * tracking, no adaptive re-sweep, no MutationObserver for dynamic content,
 * no attribute/title translation, no per-site/per-language rules. All of
 * that is the recent, deliberate engineering this repo already did in the
 * old contentScript/pageTranslator.js — it gets ported (not reinvented) in
 * Phase 2, once this minimal version has proven the plumbing works.
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  allFrames: true,
  matchAboutBlank: true,
  async main() {
    await twpConfig.onReady();

    let pageLanguageState: 'original' | 'translated' = 'original';
    const nodesToRestore: Array<{ node: Text; original: string }> = [];

    const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA']);

    function collectTextNodes(root: Node): Text[] {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const parent = (node as Text).parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;
          if (!node.textContent || !node.textContent.trim()) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const nodes: Text[] = [];
      let n: Node | null;
      while ((n = walker.nextNode())) nodes.push(n as Text);
      return nodes;
    }

    async function translatePage(targetLanguage: string) {
      const nodes = collectTextNodes(document.body);
      nodesToRestore.length = 0;
      nodes.forEach((node) => nodesToRestore.push({ node, original: node.data }));

      const BATCH_SIZE = 50;
      for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
        const batch = nodes.slice(i, i + BATCH_SIZE);
        const results = await sendMessage('translateHTML', {
          translationService: 'google',
          sourceLanguage: 'auto',
          targetLanguage,
          sourceArray2d: batch.map((node) => [node.data]),
        });
        results.forEach((result, idx) => {
          const translated = result?.[0];
          if (translated) batch[idx].data = translated;
        });
      }

      pageLanguageState = 'translated';
    }

    function restorePage() {
      nodesToRestore.forEach(({ node, original }) => {
        node.data = original;
      });
      nodesToRestore.length = 0;
      pageLanguageState = 'original';
    }

    onMessage('getCurrentPageLanguageState', () => pageLanguageState);
    onMessage('translatePage', async (message) => {
      const targetLanguage = message.data?.targetLanguage ?? twpConfig.get('targetLanguage') ?? 'en';
      await translatePage(targetLanguage);
    });
    onMessage('restorePage', () => {
      restorePage();
    });
  },
});
