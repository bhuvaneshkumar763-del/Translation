import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * modules/providers/registry.ts's `getSafeServiceByName` gating had no
 * tests — it's the one gate standing between "a message asked for
 * translation via service X" and an actual network call, so a bug here
 * either silently blocks a legitimately-configured service or (worse) lets
 * an unconfigured one through. Not exported directly, so exercised through
 * the public `translationService.*` methods, same as real callers.
 *
 * registry.ts imports modules/config/store.ts (twpConfig, a module-level
 * singleton reading the `browser` global at import time) — same isolation
 * concerns as store.test.ts, so each test gets a fresh module instance via
 * vi.resetModules() + a dynamic import, backed by a reset fake browser.
 *
 * Real provider network calls are sidestepped by swapping in a stub
 * TranslationProvider via the exported `serviceList` Map rather than
 * mocking fetch/XHR — this test is about the gating logic, not any one
 * provider's request format (google.test.ts/llm.test.ts/etc. would be the
 * place for that).
 */

async function freshRegistry() {
  vi.resetModules();
  const store = await import('../config/store');
  await store.twpConfig.onReady();
  const registry = await import('./registry');
  return { store, registry };
}

describe('translationService gating (getSafeServiceByName)', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    fakeBrowser.i18n.getAcceptLanguages = vi.fn().mockResolvedValue([]);
  });

  it('a built-in service present in the default enabledServices is usable', async () => {
    const { registry } = await freshRegistry();
    const stub = { translate: vi.fn().mockResolvedValue([['hola']]) };
    registry.serviceList.set('google', stub);

    const result = await registry.translationService.translateHTML('google', 'en', 'es', [['hello']]);

    expect(stub.translate).toHaveBeenCalledWith('en', 'es', [['hello']], false, false);
    expect(result).toEqual([['hola']]);
  });

  it('a built-in service removed from enabledServices is gated out — translate() is never called', async () => {
    const { store, registry } = await freshRegistry();
    await store.twpConfig.set('enabledServices', ['google']); // yandex no longer in the list
    const stub = { translate: vi.fn().mockResolvedValue([['x']]) };
    registry.serviceList.set('yandex', stub);

    const result = await registry.translationService.translateHTML('yandex', 'en', 'es', [['hello']]);

    expect(stub.translate).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('a key-requiring service (llm) with no matching customServices entry is gated out', async () => {
    const { registry } = await freshRegistry();
    registry.serviceList.delete('llm'); // clean slate — not registered at all yet

    const result = await registry.translationService.translateHTML('llm', 'en', 'es', [['hello']]);

    expect(result).toEqual([]);
  });

  it('a key-requiring service becomes usable once it has a matching customServices entry', async () => {
    const { store, registry } = await freshRegistry();
    await store.twpConfig.set('customServices', [
      { name: 'llm', baseUrl: 'https://api.example.com', apiKey: 'k', model: 'm' },
    ]);
    // Wires applyCustomServices via twpConfig.onReady — since config is
    // already ready by this point, the callback fires synchronously and
    // registers a real createLlmService('https://api.example.com', ...)
    // instance under 'llm'. Immediately override it with a stub so this
    // test stays about gating, not the llm provider's request format.
    registry.initProviderRegistry();
    const stub = { translate: vi.fn().mockResolvedValue([['hola']]) };
    registry.serviceList.set('llm', stub);

    const result = await registry.translationService.translateHTML('llm', 'en', 'es', [['hello']]);

    expect(stub.translate).toHaveBeenCalled();
    expect(result).toEqual([['hola']]);
  });

  it('an unrecognized service name is gated out', async () => {
    const { registry } = await freshRegistry();

    const result = await registry.translationService.translateHTML('not-a-real-service', 'en', 'es', [['hello']]);

    expect(result).toEqual([]);
  });

  it('a feature-detected provider (builtin) is gated purely on isAvailable(), independent of enabledServices/customServices', async () => {
    const { store, registry } = await freshRegistry();
    expect(store.twpConfig.get('enabledServices')).not.toContain('builtin');
    expect(store.twpConfig.get('customServices')).toEqual([]);
    const stub = { translate: vi.fn().mockResolvedValue([['x']]) };
    registry.serviceList.set('builtin', stub);

    // No globalThis.Translator defined in this test environment, so
    // descriptors.ts's isAvailable() check for 'builtin' is false.
    const result = await registry.translationService.translateHTML('builtin', 'en', 'es', [['hello']]);

    expect(stub.translate).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('translateText and translateSingleText apply the same gating as translateHTML', async () => {
    const { store, registry } = await freshRegistry();
    await store.twpConfig.set('enabledServices', []); // gate every built-in service out
    const stub = { translate: vi.fn().mockResolvedValue([['x']]) };
    registry.serviceList.set('google', stub);

    expect(await registry.translationService.translateText('google', 'en', 'es', ['hello'])).toEqual([]);
    expect(await registry.translationService.translateSingleText('google', 'en', 'es', 'hello')).toBeUndefined();
    expect(stub.translate).not.toHaveBeenCalled();
  });
});
