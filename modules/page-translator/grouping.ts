import type { BatchingHint } from '../providers/descriptors';

/**
 * Groups consecutive queued text nodes that share the same nearest
 * block-level ancestor into one piece — giving a context-hungry provider
 * (the LLM) real paragraph/sentence context instead of one isolated word or
 * sentence fragment per request. Extracted from translateLoop.ts as its own
 * pure(-ish — reads live DOM ancestry, but takes no other state) function so
 * it's testable without spinning up the whole page-translation engine.
 *
 * Deliberately simple: a linear scan over `nodes` in their given (queue)
 * order, not a full DOM-tree walk — `collectTextNodes` already produces
 * nodes in document order via depth-first traversal, so nodes under the
 * same block end up adjacent in the common case. Not a guarantee for every
 * possible DOM shape, just a reasonable heuristic; a node that ends up
 * ungrouped still gets translated correctly on its own, just without the
 * extra context.
 */

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'LI',
  'TD',
  'TH',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'BLOCKQUOTE',
  'ARTICLE',
  'SECTION',
  'FIGCAPTION',
  'DT',
  'DD',
]);

function nearestBlockAncestor(node: Text): Element | null {
  let el = node.parentElement;
  while (el && !BLOCK_TAGS.has(el.tagName)) {
    el = el.parentElement;
  }
  return el;
}

/** Splits `nodes` into groups suitable for a single translate-request piece each, respecting `hint.maxGroupChars` and (if `groupByBlock`) block-ancestor boundaries. Returns one group per node (today's default one-node-per-piece behavior) when `hint` is undefined or `groupByBlock` is false. */
export function groupNodesForBatching(nodes: Text[], hint: BatchingHint | undefined): Text[][] {
  if (!hint?.groupByBlock) return nodes.map((n) => [n]);

  const groups: Text[][] = [];
  let currentGroup: Text[] = [];
  let currentBlock: Element | null = null;
  let currentChars = 0;

  for (const node of nodes) {
    const block = nearestBlockAncestor(node);
    const wouldExceedBudget = currentChars + node.data.length > hint.maxGroupChars;
    const blockChanged = currentGroup.length > 0 && block !== currentBlock;

    if (currentGroup.length > 0 && (blockChanged || wouldExceedBudget)) {
      groups.push(currentGroup);
      currentGroup = [];
      currentChars = 0;
    }

    currentGroup.push(node);
    currentChars += node.data.length;
    currentBlock = block;
  }

  if (currentGroup.length > 0) groups.push(currentGroup);
  return groups;
}
