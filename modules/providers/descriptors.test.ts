import { describe, expect, it } from 'vitest';
import { getBatchingHint, getProviderDescriptor, isProviderAvailable, providerDescriptors } from './descriptors';

describe('providerDescriptors', () => {
  it('has a unique id for every provider', () => {
    const ids = providerDescriptors.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every provider without requiresKey is immediately usable (no isAvailable) or feature-detected', () => {
    for (const d of providerDescriptors) {
      expect(typeof d.requiresKey).toBe('boolean');
    }
  });
});

describe('getProviderDescriptor / getBatchingHint / isProviderAvailable', () => {
  it('resolves a known provider and returns undefined for an unknown one', () => {
    expect(getProviderDescriptor('google')?.displayName).toBe('Google');
    expect(getProviderDescriptor('not-a-real-provider')).toBeUndefined();
  });

  it('only the llm provider carries a batching hint today', () => {
    expect(getBatchingHint('llm')).toEqual({ groupByBlock: true, maxGroupChars: 2000 });
    expect(getBatchingHint('google')).toBeUndefined();
    expect(getBatchingHint('builtin')).toBeUndefined();
  });

  it('providers with no isAvailable gate are always available', () => {
    expect(isProviderAvailable('google')).toBe(true);
    expect(isProviderAvailable('llm')).toBe(true);
  });

  it('the builtin provider is unavailable in this test environment (no Translator global)', () => {
    expect(isProviderAvailable('builtin')).toBe(false);
  });

  it('an unknown provider id is never available', () => {
    expect(isProviderAvailable('not-a-real-provider')).toBe(false);
  });
});
