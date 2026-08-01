---
"prism-translate": major
---

Fix "always translate this site" doing nothing — second and actual root cause — by removing `chrome.storage.sync` entirely.

The permission-model revert in the previous release didn't fix the reported problem. A side-by-side reread against the user's working pre-rewrite fork found a separate cause: the cross-device settings sync added in Gen 2 Session 4 routed `alwaysTranslateSites`, `pageTranslatorService` and `targetLanguage` to `chrome.storage.sync`. That area can be present-but-non-functional on WebKit-based browsers (Orion for iOS), or readable in extension pages while returning nothing in content scripts — so the options page showed a site in the always-translate list while the page translator read the same key, got an empty array, and never translated. No error surfaced anywhere. The old fork used `chrome.storage.local` exclusively and never had this failure mode.

- All config is back on `chrome.storage.local`. `SYNCED_CONFIG_KEYS` is deleted, and `storageKeyFor()` carries a "do not reintroduce" note with the full account.
- A one-time migration reclaims any settings stranded in sync storage by the beta builds (local wins where both exist), so upgrading doesn't look like a reset to defaults.
- Cross-device sync is gone by explicit choice; export/import in Settings → Backup replaces it.
- The auto-translate-on-load path is hardened so this class of silent failure can't recur: language detection is feature-detected and try/caught, the visibility wait can no longer hang forever, `browser.extension.inIncognitoContext` is optional-chained, and the decision chain has a real catch. An undetectable language now degrades to "translate anyway if the user asked for this site" rather than to silence.

Also adds a **Diagnostics** panel (Settings → Advanced) that probes what actually works in the browser it's running in — storage read/write round trips, the raw contents of each storage area for the translate lists, capability checks, and the effective config — so an untestable browser can be diagnosed from evidence instead of guesswork.
