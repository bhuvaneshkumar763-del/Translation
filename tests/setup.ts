// Vitest setup: polyfills for browser APIs used by code under test that
// wasn't written with Node in mind (indexedDB) — see vitest.config.ts's
// `setupFiles`. Needed because modules/cache/translationCache.ts uses
// real indexedDB, and modules/providers/types.ts's Service class imports
// it — anything exercising Service.translate() end-to-end needs this.
import 'fake-indexeddb/auto';
