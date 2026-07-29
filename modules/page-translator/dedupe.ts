/**
 * O(1) identity-dedupe tracking, ported from the "TWP-FullPage: O(1) dedupe
 * tracking" patch in the old contentScript/pageTranslator.js.
 *
 * The naive approach (which the old code originally had, before this fork's
 * hardening pass) checks "is this node already queued?" by scanning every
 * existing piece for every candidate node — with a MutationObserver-driven
 * re-sweep running every couple of seconds on a long page, that nested scan
 * became the hottest loop in the extension. A WeakSet/WeakMap makes
 * membership checks O(1); WeakSet/WeakMap specifically (not Set/Map) so that
 * once a node leaves the DOM and is garbage-collected, its tracking entry
 * disappears with it instead of leaking memory forever.
 */
export function createDedupeTracker() {
  let trackedNodes = new WeakSet<Node>();
  let trackedAttrs = new WeakMap<Element, Set<string>>();

  return {
    isTracked(node: Node): boolean {
      return trackedNodes.has(node);
    },
    track(nodes: Iterable<Node>): void {
      for (const n of nodes) trackedNodes.add(n);
    },
    isAttrTracked(el: Element, attrName: string): boolean {
      return trackedAttrs.get(el)?.has(attrName) ?? false;
    },
    trackAttr(el: Element, attrName: string): void {
      let set = trackedAttrs.get(el);
      if (!set) {
        set = new Set();
        trackedAttrs.set(el, set);
      }
      set.add(attrName);
    },
    /** Rebuilt at the start of each translate cycle so nodes from a previous
     * cycle that left and re-entered the DOM aren't wrongly considered tracked. */
    reset(): void {
      trackedNodes = new WeakSet();
      trackedAttrs = new WeakMap();
    },
  };
}

export type DedupeTracker = ReturnType<typeof createDedupeTracker>;
