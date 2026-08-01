import { afterEach, describe, expect, it, vi } from 'vitest';
import { builtinService } from './builtin';

afterEach(() => {
  globalThis.Translator = undefined;
});

describe('builtinService', () => {
  it('returns empty results (not a throw) when the Translator API is not present', async () => {
    const results = await builtinService.translate('en', 'es', [['hello']], true);
    expect(results).toEqual([[]]);
  });

  it('returns empty results when the language pair is unavailable', async () => {
    globalThis.Translator = {
      availability: vi.fn().mockResolvedValue('unavailable'),
      create: vi.fn(),
    };
    const results = await builtinService.translate('en', 'xx', [['hello']], true);
    expect(results).toEqual([[]]);
  });

  it('translates every string in every piece via the created translator, preserving shape', async () => {
    const translate = vi.fn(async (text: string) => `[${text}]`);
    globalThis.Translator = {
      availability: vi.fn().mockResolvedValue('available'),
      create: vi.fn().mockResolvedValue({ translate }),
    };

    const results = await builtinService.translate('en', 'es', [['hello', 'world'], ['third']], true);

    expect(results).toEqual([['[hello]', '[world]'], ['[third]']]);
    expect(translate).toHaveBeenCalledTimes(3);
  });

  it('reuses one translator instance across multiple translate() calls for the same language pair', async () => {
    const create = vi.fn().mockResolvedValue({ translate: vi.fn(async (t: string) => t) });
    globalThis.Translator = { availability: vi.fn().mockResolvedValue('available'), create };

    await builtinService.translate('en', 'de', [['a']], true);
    await builtinService.translate('en', 'de', [['b']], true);

    expect(create).toHaveBeenCalledTimes(1);
  });
});
