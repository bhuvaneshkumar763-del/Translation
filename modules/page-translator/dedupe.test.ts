// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createDedupeTracker } from './dedupe';

describe('createDedupeTracker', () => {
  it('starts with nothing tracked', () => {
    const dedupe = createDedupeTracker();
    const node = document.createTextNode('hello');
    expect(dedupe.isTracked(node)).toBe(false);
  });

  it('track() marks nodes as tracked', () => {
    const dedupe = createDedupeTracker();
    const a = document.createTextNode('a');
    const b = document.createTextNode('b');
    dedupe.track([a, b]);
    expect(dedupe.isTracked(a)).toBe(true);
    expect(dedupe.isTracked(b)).toBe(true);
  });

  it('does not consider an untracked node tracked just because another node is', () => {
    const dedupe = createDedupeTracker();
    const a = document.createTextNode('a');
    const b = document.createTextNode('b');
    dedupe.track([a]);
    expect(dedupe.isTracked(a)).toBe(true);
    expect(dedupe.isTracked(b)).toBe(false);
  });

  it('reset() clears previously tracked nodes', () => {
    const dedupe = createDedupeTracker();
    const a = document.createTextNode('a');
    dedupe.track([a]);
    expect(dedupe.isTracked(a)).toBe(true);
    dedupe.reset();
    expect(dedupe.isTracked(a)).toBe(false);
  });

  it('tracks attributes per-element, independent of text-node tracking', () => {
    const dedupe = createDedupeTracker();
    const el = document.createElement('img');
    expect(dedupe.isAttrTracked(el, 'alt')).toBe(false);
    dedupe.trackAttr(el, 'alt');
    expect(dedupe.isAttrTracked(el, 'alt')).toBe(true);
    // A different attribute on the same element is independently tracked.
    expect(dedupe.isAttrTracked(el, 'title')).toBe(false);
  });

  it('does not confuse attribute tracking between two different elements', () => {
    const dedupe = createDedupeTracker();
    const a = document.createElement('img');
    const b = document.createElement('img');
    dedupe.trackAttr(a, 'alt');
    expect(dedupe.isAttrTracked(a, 'alt')).toBe(true);
    expect(dedupe.isAttrTracked(b, 'alt')).toBe(false);
  });

  it('reset() also clears attribute tracking', () => {
    const dedupe = createDedupeTracker();
    const el = document.createElement('img');
    dedupe.trackAttr(el, 'alt');
    dedupe.reset();
    expect(dedupe.isAttrTracked(el, 'alt')).toBe(false);
  });
});
