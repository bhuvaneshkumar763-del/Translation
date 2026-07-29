/**
 * MutationObserver wiring, ported from the old contentScript/pageTranslator.js
 * (the `mutationObserver` + "TWP-FullPage: in-place text-swap detection"
 * patch). Watches for two things:
 *
 * 1. childList mutations — new elements/text added to the page (dynamic
 *    content, infinite scroll, SPA navigation).
 * 2. characterData mutations on already-translated pages — several reader
 *    sites swap chapter text by writing directly into an EXISTING text node
 *    (`node.data = "..."`) instead of inserting new nodes, which fires no
 *    childList mutation at all and would otherwise stay untranslated
 *    forever. The loop guard (`isOwnWrite`) distinguishes "we just wrote
 *    this translation" from "the site changed the text under us" — every
 *    write this extension makes must be reported via `noteOwnWrite` first.
 *
 * Note on scope: the old code batches newly-added nodes into "pieces"
 * (paragraph-level translation units spanning multiple elements, built by
 * the ~2000-line getPiecesToTranslate). This port works on individual Text
 * nodes instead — a deliberate simplification for this phase, not a
 * correctness regression: every text node still gets found and translated,
 * just without the old code's paragraph-level batching for context/fewer
 * requests. Revisit if translation quality/request-volume becomes an issue.
 */

export interface MutationWatcherOptions {
  isTranslated(): boolean;
  isNoTranslateNode(node: Node): boolean;
  onNewRoot(root: Node): void;
  onChangedTextNode(node: Text): void;
}

export function createMutationWatcher(options: MutationWatcherOptions) {
  const lastWritten = new WeakMap<Text, string>();

  function noteOwnWrite(node: Text, text: string): void {
    lastWritten.set(node, text);
  }

  const HAS_LETTER = /\p{L}/u;

  const observer = new MutationObserver((mutations) => {
    const newRoots: Node[] = [];
    const changedTextNodes: Text[] = [];

    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (!options.isNoTranslateNode(node)) newRoots.push(node);
      });

      if (mutation.type === 'characterData' && options.isTranslated()) {
        const t = mutation.target as Text;
        const parent = t.parentNode;
        if (
          t.isConnected &&
          lastWritten.get(t) !== t.data &&
          HAS_LETTER.test(t.data || '') &&
          parent &&
          !options.isNoTranslateNode(parent) &&
          !changedTextNodes.includes(t) &&
          changedTextNodes.length < 25
        ) {
          changedTextNodes.push(t);
        }
      }
    }

    newRoots.forEach((root) => options.onNewRoot(root));
    changedTextNodes.forEach((node) => options.onChangedTextNode(node));
  });

  let dynamicContentInterval: ReturnType<typeof setInterval> | null = null;

  function enable(rescanIntervalMs = 500, onRescan?: () => void): void {
    disable();
    // A periodic full re-walk of document.body, on top of the mutation
    // observer, catches anything the observer's targeted childList
    // reporting missed (see modules/page-translator/resweep.ts for the
    // longer-interval, backing-off version of this same idea).
    if (onRescan) {
      dynamicContentInterval = setInterval(onRescan, rescanIntervalMs);
    }
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function disable(): void {
    if (dynamicContentInterval) clearInterval(dynamicContentInterval);
    dynamicContentInterval = null;
    observer.disconnect();
    observer.takeRecords();
  }

  return { enable, disable, noteOwnWrite };
}

export type MutationWatcher = ReturnType<typeof createMutationWatcher>;
