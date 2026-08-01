# Changelog

## 13.0.0-beta.3

### Minor Changes

- Translate the tab-bar title, not just the page — and a post-Gen-2 audit pass fixing real bugs found along the way.

  - **Tab-bar title translation** (`modules/page-translator/titleTranslator.ts`, new): Prism previously never touched `<title>` at all — page translation only ever walked from `document.body`. Ported the fix from this project's original pre-rewrite fork, including the two dead ends it took to get there: a naive single-string translation request hits a real `modules/providers/google.ts` quirk (only batches of more than one item get the `<a i=N>` wrapping Google's endpoint needs to translate reliably), and making that wrapping unconditional everywhere (the fork's first attempt) regressed every other single-text translation path in the extension. The actual fix, scoped to just the title: send it alongside a throwaway second string, and write the result to both `document.title` and the `<title>` element (they can drift out of sync — writing only one left the tab bar stale even after translation succeeded). Kept current via a `MutationObserver` on `<head>` plus a polling fallback, with an in-memory cache and a visibility gate so sites that rewrite their title constantly don't trigger a request per change. Verified with a real Playwright round trip against the built extension (mock LLM server), not just unit tests.
  - **Fixed the same Solid.js reactivity bug in 4 more places**: `components/mobile-popup/MobilePopup.tsx` (the gear menu's ✔ checkmarks never updated after tapping an option — the most visible instance), `components/hover-tooltip/TranslatedTextTooltip.tsx`, `entrypoints/improve-translation/App.tsx`, and `entrypoints/translate-text/App.tsx`, plus `components/selection-popup/SelectionPopup.tsx` for good measure. Root cause each time: reading `twpConfig.get(...)` directly inside JSX isn't reactive (a plain object property, not a signal), so Solid never re-renders after the initial mount. A CI step now greps for this exact pattern so it can't ship a fourth time undetected.
  - **Deleted 11 dead config keys** (never read anywhere outside the config layer itself) via a real config migration — `CONFIG_SCHEMA_VERSION` bumped to 2, exercising the migration system for the first time since it was built.
  - **Reconciled shadow-DOM color drift**: `FloatingBubble.tsx`/`SelectionPopup.tsx` had drifted to a few near-duplicate hex values not present in `styles/tokens.css`; reconciled to the real tokens, and genuinely-new shades were added as `--prism-success-dark`/`--prism-bg-hover` instead of staying untracked.
  - Fixed 15 real (non-stylistic) lint findings, and a bug the accompanying test suite itself found: `titleTranslator.ts` had no in-flight-request guard, so a single DOM mutation firing the `MutationObserver` more than once before the first request resolved could race a duplicate translation request for the same text.
  - Added 48 new unit tests (41 → 89) for previously-untested modules: `modules/config/store.ts` (the exact file that caused the `chrome.storage.sync` bug fixed in the previous release), `titleTranslator.ts`, `modules/providers/registry.ts`, `dedupe.ts`, and `resweep.ts`.

## 13.0.0-beta.2

### Major Changes

- Fix "always translate this site" doing nothing — second and actual root cause — by removing `chrome.storage.sync` entirely.

  The permission-model revert in the previous release didn't fix the reported problem. A side-by-side reread against the user's working pre-rewrite fork found a separate cause: the cross-device settings sync added in Gen 2 Session 4 routed `alwaysTranslateSites`, `pageTranslatorService` and `targetLanguage` to `chrome.storage.sync`. That area can be present-but-non-functional on WebKit-based browsers (Orion for iOS), or readable in extension pages while returning nothing in content scripts — so the options page showed a site in the always-translate list while the page translator read the same key, got an empty array, and never translated. No error surfaced anywhere. The old fork used `chrome.storage.local` exclusively and never had this failure mode.

  - All config is back on `chrome.storage.local`. `SYNCED_CONFIG_KEYS` is deleted, and `storageKeyFor()` carries a "do not reintroduce" note with the full account.
  - A one-time migration reclaims any settings stranded in sync storage by the beta builds (local wins where both exist), so upgrading doesn't look like a reset to defaults.
  - Cross-device sync is gone by explicit choice; export/import in Settings → Backup replaces it.
  - The auto-translate-on-load path is hardened so this class of silent failure can't recur: language detection is feature-detected and try/caught, the visibility wait can no longer hang forever, `browser.extension.inIncognitoContext` is optional-chained, and the decision chain has a real catch. An undetectable language now degrades to "translate anyway if the user asked for this site" rather than to silence.

  Also adds a **Diagnostics** panel (Settings → Advanced) that probes what actually works in the browser it's running in — storage read/write round trips, the raw contents of each storage area for the translate lists, capability checks, and the effective config — so an untestable browser can be diagnosed from evidence instead of guesswork.

## 13.0.0-beta.1

### Major Changes

- Reverted the activeTab-by-default permission model back to unconditional `<all_urls>` access, matching the extension's original (pre-Gen-2) behavior.

  A real user reported "always translate this site" only ever worked immediately after a fresh click — never automatically on a later visit — specifically on Orion for iOS (a WebKit-based browser). Root cause, confirmed against the user's own previously-working pre-rewrite fork: the scoped model's "automatic translation" opt-in depended on `scripting.registerContentScripts`, a newer MV3 API that browser doesn't support, with no native fallback to grant the equivalent access another way. Presented as an explicit choice, the user chose to revert rather than accept automatic translation being permanently broken there.

  What changed: `host_permissions` is `['<all_urls>']` again; `content-main` is a static `content_scripts` entry again (not runtime-registered); the now-pointless dynamic-registration module, its install-time onboarding page, and the "Enable automatic translation on all sites" toggle are all removed. The on-demand injection fallback for tabs that predate an install/reload is unchanged.

## 12.1.0-beta.0

### Minor Changes

- 75d28a3: Add a one-time welcome/onboarding page, opened automatically right after install, that offers the "automatic translation on all sites" permission up front — the same one-time browser permission the equivalent Settings → Page toggle already requested, now surfaced where new users will actually see it instead of only living inside Settings.
- 3ba587d: Fix a real bug reported by a user: adding or removing a site/language in the options page's list editors (always/never-translate sites and languages, hover-translate lists) — and toggling settings in the popup — silently didn't update on screen, even though the change was correctly saved. Both files were reading config values directly in JSX instead of through a reactive store, so Solid never re-rendered after the initial mount. Fixed with a genuine reactive store mirroring config state in both files.

  Also: language pickers in the options page (always/never-translate languages, hover-translate languages, preferred target languages) are now a dropdown of language names instead of a free-text field requiring a raw ISO code.

  And: `syncContentMainRegistration()` now feature-detects `scripting.registerContentScripts` before using it, so browsers whose WebExtension implementation doesn't support it (reported with Orion on iOS) degrade gracefully instead of throwing — "always translate" on such a browser now just requires a fresh click rather than silently breaking background registration.

## 12.0.0

### Major Changes

- Gen 2 rebuild: rebrand to Prism, LLM-first translation engine, full UI
  redesign, and a modern permission/privacy model.

  - **Rebrand**: new name ("Prism — AI Page Translator"), new indigo/violet
    icon and visual identity across every surface.
  - **New translation engine mechanics**: an OpenAI-compatible LLM provider
    (bring-your-own key/endpoint/model) with block-context-aware batching and
    structural response validation/retry, plus a fully on-device provider
    using Chrome's built-in Translator API (no key, no network call). A
    generalized provider-descriptor registry replaces the old hand-maintained
    per-provider wiring.
  - **Full UI redesign**: the toolbar popup, floating bubble, options page
    (now tabbed), hover tooltips, mobile popup, selection popup, and all
    three standalone windows are rebuilt on a shared design-token system. The
    legacy dual-popup system (old-popup alternate skin) is retired — one
    popup now.
  - **Modern permissions model**: `host_permissions` scoped down from an
    unconditional `<all_urls>` to `activeTab` plus an optional, user-controlled
    `<all_urls>` grant for the old always-on experience — Prism only reads a
    page when asked to, by default.
  - **Cross-device settings sync** via `chrome.storage.sync` for language
    preferences, translate lists, and behavior toggles (API keys and
    unbounded per-host data stay local-only).
  - **Real test/CI infrastructure**: Vitest unit tests, a formalized
    Playwright E2E smoke suite, GitHub Actions CI (typecheck → tests → build
    → E2E, now with a parallel Firefox build job and a bundle-size
    guardrail), and this changeset-based release process.

> Entries from this point up are generated by [Changesets](https://github.com/changesets/changesets)
> (`npm run changeset` to add one, `npm run version` to apply pending ones —
> see `.changeset/README.md`), introduced in Gen 2 Session 5. Everything
> below the Gen 2 entries is the older, hand-written skeleton-rewrite
> history — kept for the record, not maintained further.

## 11.0.0 — WXT + TypeScript + Solid rewrite

A full rewrite of the extension's skeleton: vanilla JS/`importScripts` bundles
replaced with [WXT](https://wxt.dev), TypeScript throughout, and
[Solid](https://www.solidjs.com) for every UI surface. `chrome.storage.local`
keeps the exact same keys and shapes, so existing installs upgrade without
losing settings.

**What's new or changed, not just ported:**

- A lightweight `chrome.alarms`-based service-worker keepalive (the old code
  had none — a real gap under Manifest V3's ~30s idle timeout).
- A hardened, size-budgeted disk cache for translations (eviction once past
  80MB, trimmed back to 60MB), carried over from earlier work on this fork.
- Adaptive resweep + O(1) dedupe for the page-translation engine, so dynamic
  content gets picked up without duplicate-translating or hammering the
  network on every mutation.
- The floating translate bubble, rebuilt with a modern draggable-card UI.

**Update:** the old-popup alternate UI and the three standalone windows
(`translate-text`, `translate-document`, `improve-translation`) — originally
deferred (see below) — have since been built. See `git log` for that work.
The `useOldPopup` config key correctly swapped the toolbar popup between the
new and old skins at runtime, same as the pre-rewrite code's
`resetBrowserAction` — **this is now historical**: the old-popup skin and
`useOldPopup` were deleted entirely in the Gen 2 rebuild's Session 3 (see
the Gen 2 entry above/below for the full rebuild). One popup now, not two.

**Deliberately not carried over, with reasoning kept in the code/commit
history for each:**

- A handful of upstream-project-specific integrations tied to the original
  author's own hosted services (the PDF-viewer webapp at
  `pdf.translatewebpages.org`, Patreon/donation links) — not general
  extension functionality.
- Toolbar-icon state changes reflecting translated/original (the old
  `icon-32-translated.png` swap) — a small cosmetic gap, not yet wired up.

(Originally deferred, now built: the old-popup alternate UI at
`popup/old-popup.*` — a legacy visual skin some users prefer over the new
popup — and the three standalone windows `popup/popup-translate-text.*`,
`popup/popup-translate-document.*`, `popup/improve-translation.*`.)

**Cleanup:** the dead pre-rewrite vanilla-JS source trees (`popup/old-popup.js`,
`popup/improve-translation.js`, `popup/popup-translate-text.js`,
`popup/popup-translate-document.js`, `popup/detect-pdf.js`, and
`options/release-notes/en.html`) have been deleted — they were kept around
only as porting reference and nothing in the built extension imported them.
Pull from git history if any of that content is needed again.

See the git history on this rewrite for the phase-by-phase breakdown (config

- messaging skeleton, each translation provider, the page-translation engine,
  the floating bubble, selection/hover/mobile-popup features, the toolbar
  popup + options page, then cache/context-menus/commands/keepalive) and how
  each phase was verified.
