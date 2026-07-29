// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { groupNodesForBatching } from './grouping';

function textNode(text: string): Text {
  return document.createTextNode(text);
}

describe('groupNodesForBatching', () => {
  it('returns one group per node when hint is undefined (default MT-provider behavior)', () => {
    const p = document.createElement('p');
    const a = textNode('hello');
    const b = textNode('world');
    p.append(a, b);

    const groups = groupNodesForBatching([a, b], undefined);

    expect(groups).toEqual([[a], [b]]);
  });

  it('returns one group per node when groupByBlock is false', () => {
    const p = document.createElement('p');
    const a = textNode('hello');
    p.append(a);

    const groups = groupNodesForBatching([a], { groupByBlock: false, maxGroupChars: 9999 });

    expect(groups).toEqual([[a]]);
  });

  it('groups sibling text nodes under the same block element into one piece', () => {
    const p = document.createElement('p');
    const a = textNode('Hello ');
    const b = document.createElement('b');
    const bText = textNode('world');
    b.append(bText);
    const c = textNode('!');
    p.append(a, b, c);

    const groups = groupNodesForBatching([a, bText, c], { groupByBlock: true, maxGroupChars: 9999 });

    // All 3 nodes share <p> as their nearest block ancestor (bText's direct
    // parent is <b>, an inline element, not a block tag).
    expect(groups).toEqual([[a, bText, c]]);
  });

  it('starts a new group when the nearest block ancestor changes', () => {
    const p1 = document.createElement('p');
    const a = textNode('first paragraph');
    p1.append(a);
    const p2 = document.createElement('p');
    const b = textNode('second paragraph');
    p2.append(b);
    document.body.append(p1, p2);

    const groups = groupNodesForBatching([a, b], { groupByBlock: true, maxGroupChars: 9999 });

    expect(groups).toEqual([[a], [b]]);
  });

  it('starts a new group when maxGroupChars would be exceeded, even within the same block', () => {
    const p = document.createElement('p');
    const a = textNode('12345');
    const b = textNode('67890');
    const c = textNode('abcde');
    p.append(a, b, c);

    // Budget of 8: "12345" (5) fits alone; adding "67890" (5 more, total 10)
    // exceeds 8, so it starts a new group; "abcde" then joins "67890"'s
    // group since 5+5=10 > 8 again — starts its own group too.
    const groups = groupNodesForBatching([a, b, c], { groupByBlock: true, maxGroupChars: 8 });

    expect(groups).toEqual([[a], [b], [c]]);
  });

  it('keeps nodes together under the char budget in the same block', () => {
    const p = document.createElement('p');
    const a = textNode('ab');
    const b = textNode('cd');
    p.append(a, b);

    const groups = groupNodesForBatching([a, b], { groupByBlock: true, maxGroupChars: 100 });

    expect(groups).toEqual([[a, b]]);
  });

  it('treats a node with no element ancestor (block === null) as its own consistent group', () => {
    // A detached text node (no parentElement at all) — nearestBlockAncestor returns null for both, so they group together.
    const a = textNode('detached-a');
    const b = textNode('detached-b');

    const groups = groupNodesForBatching([a, b], { groupByBlock: true, maxGroupChars: 9999 });

    expect(groups).toEqual([[a, b]]);
  });
});
