import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from './schema';

/**
 * modules/config/store.ts had zero tests before this — a real regression
 * shipped from it (the chrome.storage.sync split-brain documented at length
 * in that file's own header comment and CLAUDE.md's "Permission model"
 * section) and it hosts every config migration going forward. Covers:
 * local-only storage (get/set/onChanged), the legacy-storage-key read path,
 * and the dead-key migration added in Phase 3 of the post-Gen-2 audit.
 *
 * store.ts holds module-level singleton state (`state`, `configIsReady`,
 * `readyPromise`) and reads the `browser` global once at import time (via
 * @wxt-dev/storage — see tests/setup.ts's comment on why the fake-browser
 * shim has to live in a setupFile, not a per-test vi.stubGlobal). So each
 * test resets the fake browser AND re-imports the module fresh via
 * vi.resetModules() + a dynamic import, rather than sharing one twpConfig
 * instance across tests.
 */

// Does NOT call fakeBrowser.reset() — callers that need to seed storage
// before the module's own initConfig() runs must do so BEFORE calling this
// (reset() wipes storage, so resetting here would erase anything the test
// already seeded). Each `it()` below resets in its own beforeEach instead.
async function freshStore() {
  // fake-browser implements i18n.getAcceptLanguages as a stub that throws
  // "not implemented" rather than omitting it — store.ts's initConfig()
  // calls it (target-language backfill) whenever it's present, so it needs
  // a real resolved value here, not just to be left undefined.
  fakeBrowser.i18n.getAcceptLanguages = vi.fn().mockResolvedValue([]);
  vi.resetModules();
  return import('./store');
}

describe('twpConfig', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('loads defaults when storage is empty', async () => {
    const { twpConfig } = await freshStore();
    await twpConfig.onReady();
    expect(twpConfig.get('pageTranslatorService')).toBe(defaultConfig.pageTranslatorService);
    expect(twpConfig.get('targetLanguages').length).toBeGreaterThan(0); // backfilled, see initConfig
  });

  it('set() persists to chrome.storage.local under the plain (unprefixed) key', async () => {
    const { twpConfig } = await freshStore();
    await twpConfig.onReady();
    await twpConfig.set('pageTranslatorService', 'llm');
    expect(twpConfig.get('pageTranslatorService')).toBe('llm');

    const raw = await fakeBrowser.storage.local.get(null);
    // wxt's storage.defineItem('local:foo') stores under the raw key "foo",
    // not "local:foo" — the "local:" part is just the driver selector. Real
    // gotcha hit while writing an ad hoc verification script for this
    // codebase; asserting it here so it can't silently regress.
    expect(raw.pageTranslatorService).toBe('llm');
    expect(raw['local:pageTranslatorService']).toBeUndefined();
  });

  it('onChanged() fires with the new value when set() is called', async () => {
    const { twpConfig } = await freshStore();
    await twpConfig.onReady();
    const seen: Array<[string, unknown]> = [];
    const unsub = twpConfig.onChanged((name, value) => seen.push([name, value]));

    await twpConfig.set('targetLanguage', 'ja');

    expect(seen).toContainEqual(['targetLanguage', 'ja']);
    unsub();
  });

  it('onChanged() unsubscribe actually stops future notifications', async () => {
    const { twpConfig } = await freshStore();
    await twpConfig.onReady();
    const seen: Array<[string, unknown]> = [];
    const unsub = twpConfig.onChanged((name, value) => seen.push([name, value]));
    unsub();

    await twpConfig.set('targetLanguage', 'de');

    expect(seen).toEqual([]);
  });

  it('reads an existing install\'s value under the OLD (legacy) storage key', async () => {
    // deeplConfirmed used to be stored as "deepl_confirmed" — an existing
    // install's data must still load correctly under that old key.
    await fakeBrowser.storage.local.set({ deepl_confirmed: 'yes' });
    const { twpConfig } = await freshStore();
    await twpConfig.onReady();
    expect(twpConfig.get('deeplConfirmed')).toBe('yes');
  });

  it('addSiteToAlwaysTranslate also removes the site from neverTranslateSites', async () => {
    const { twpConfig } = await freshStore();
    await twpConfig.onReady();
    await twpConfig.addSiteToNeverTranslate('example.com');
    expect(twpConfig.get('neverTranslateSites')).toContain('example.com');

    await twpConfig.addSiteToAlwaysTranslate('example.com');
    expect(twpConfig.get('alwaysTranslateSites')).toContain('example.com');
    expect(twpConfig.get('neverTranslateSites')).not.toContain('example.com');
  });
});

describe('twpConfig — dead-key migration (CONFIG_SCHEMA_VERSION 2)', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('strips the 11 dead config keys from storage on first load after upgrading, and bumps the version marker', async () => {
    await fakeBrowser.storage.local.set({
      showButtonInTheAddressBar: 'yes',
      popupBlueWhenSiteIsTranslated: 'no',
      showReleaseNotes: 'yes',
      hotkeys: { toggleTranslation: 'Alt+A' },
      translateTag_pre: 'yes',
      translateTagPre: 'no',
      translateDynamicallyCreatedContent: 'yes',
      autoTranslateWhenClickingALink: 'no',
      useAlternativeService: 'yes',
      addPaddingToPage: 'no',
      installDateTime: 1700000000000,
      popupPanelSection: 2,
      // A pre-migration install — no configSchemaVersion key at all yet.
    });

    const { twpConfig } = await freshStore();
    await twpConfig.onReady();

    const raw = await fakeBrowser.storage.local.get(null);
    for (const key of [
      'showButtonInTheAddressBar',
      'popupBlueWhenSiteIsTranslated',
      'showReleaseNotes',
      'hotkeys',
      'translateTag_pre',
      'translateTagPre',
      'translateDynamicallyCreatedContent',
      'autoTranslateWhenClickingALink',
      'useAlternativeService',
      'addPaddingToPage',
      'installDateTime',
      'popupPanelSection',
    ]) {
      expect(Object.hasOwn(raw, key)).toBe(false);
    }
    expect(raw.configSchemaVersion).toBe(2);
  });

  it('leaves real settings untouched by the dead-key migration', async () => {
    await fakeBrowser.storage.local.set({
      alwaysTranslateSites: ['example.com'],
      targetLanguage: 'fr',
      targetLanguages: ['fr', 'es', 'de'],
      customServices: [{ name: 'llm', baseUrl: 'http://localhost:1/x', apiKey: 'k', model: 'm' }],
      hotkeys: { toggleTranslation: 'Alt+A' }, // dead key, should still be stripped alongside the above surviving
    });

    const { twpConfig } = await freshStore();
    await twpConfig.onReady();

    expect(twpConfig.get('alwaysTranslateSites')).toEqual(['example.com']);
    expect(twpConfig.get('targetLanguage')).toBe('fr');
    expect(twpConfig.get('customServices')).toEqual([
      { name: 'llm', baseUrl: 'http://localhost:1/x', apiKey: 'k', model: 'm' },
    ]);

    const raw = await fakeBrowser.storage.local.get(null);
    expect(Object.hasOwn(raw, 'hotkeys')).toBe(false);
  });

  it('is a no-op on a second load (idempotent — does not re-run once the version marker is set)', async () => {
    await fakeBrowser.storage.local.set({ showReleaseNotes: 'yes' });
    const first = await freshStore();
    await first.twpConfig.onReady();
    expect((await fakeBrowser.storage.local.get(null)).configSchemaVersion).toBe(2);

    // Second load against the now-migrated storage should just no-op (the
    // dead key is already gone, nothing left to strip) rather than error.
    const second = await freshStore();
    await expect(second.twpConfig.onReady()).resolves.toBeUndefined();
    expect((await fakeBrowser.storage.local.get(null)).configSchemaVersion).toBe(2);
  });
});
