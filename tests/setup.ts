// Vitest setup: polyfills for browser APIs used by code under test that
// wasn't written with Node in mind — see vitest.config.ts's `setupFiles`.
//
// fake-indexeddb/auto: modules/cache/translationCache.ts uses real
// indexedDB, and modules/providers/types.ts's Service class imports it —
// anything exercising Service.translate() end-to-end needs this.
import 'fake-indexeddb/auto';

// @webext-core/fake-browser/auto: sets globalThis.browser/chrome to an
// in-memory WebExtension API implementation. Needed for
// modules/config/store.ts (built on @wxt-dev/storage, which resolves its
// own module-scope `browser` binding once, at import time — see that
// package's index.mjs — so this MUST run in a setupFile, before any test
// file's own static imports are evaluated, not inside a test body via
// vi.stubGlobal). A test that needs specific browser-API behavior can still
// override individual methods with vi.stubGlobal/vi.spyOn as usual —
// modules/messaging/ensureContentScript.test.ts already does exactly that,
// and continues to since vi.stubGlobal replaces whatever this set first.
import '@webext-core/fake-browser/auto';
