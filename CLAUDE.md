# Working on this repo — read this first

This is **Prism — AI Page Translator** (npm package `prism-translate`), a
browser extension that translates web pages in place. It started life as a
heavily-patched fork of the open-source "Traduzir Páginas Web" (TWP)
extension, and has been through two rewrites:

1. **Skeleton rewrite** (complete): the original ~16,000-line vanilla-JS/
   `importScripts` codebase was replaced with **WXT + TypeScript + Solid.js**,
   module by module, with 100% feature parity as the hard requirement.
2. **Gen 2 rebuild** (in progress): a deliberate, radical departure from
   "the old product in new clothes" — new brand ("Prism"), an LLM-driven
   translation engine (not just another MT provider in a dropdown — the
   actual recognize/send/check/speed mechanics change), and a full UI
   redesign. This is a **multi-session plan**, one ~5-hour session per part;
   see `/Users/jb/.claude/plans/so-whats-the-plan-polished-elephant.md` for
   the full session breakdown, what's done, and what's next. **Read that
   file's session map before starting any Gen 2 work** — it tells you
   exactly which session you're in and what it depends on.

If you're picking this up cold: skim this file, then the Gen 2 plan file
above (for where the rebuild stands), then `CHANGELOG.md` and `ROADMAP.md`
for the older skeleton-rewrite history, then `git log` on this branch for
the granular story.

**Branch:** all work happens on `claude/twp-extension-jp8iyh`. Don't create a
new branch for this project unless explicitly asked to.

**For a plain-language description of what the extension actually does**,
see `founder.md`. Keep that file updated — see the note at the bottom of
this doc.

## Current status (as of this writing)

The rewrite is functionally complete:
- All 5 translation providers (Google, Bing, Yandex, DeepL, LibreTranslate).
- Page-translation engine (dedupe, adaptive resweep, mutation watching).
- Text-to-speech via an offscreen document.
- The floating translate bubble (shadow-DOM UI).
- Selection translation, hover-to-translate tooltips, mobile popup.
- The toolbar popup (`entrypoints/popup`) — the legacy select-menu-driven
  `old-popup` alternate skin and its `useOldPopup` swap were removed in
  Gen 2 Session 3; don't look for either, they're gone on purpose.
- The options page.
- The three standalone auxiliary windows: `entrypoints/improve-translation`,
  `entrypoints/translate-text`, `entrypoints/translate-document`.
- Disk cache, context menus, commands/hotkeys, and a `chrome.alarms`
  keepalive (the old code had no keepalive at all — a deliberate
  improvement, not just parity).

`CHANGELOG.md` was written when 4 of the above (old-popup + the 3 standalone
windows) were still deferred; that section is now stale/historical — they
were completed afterward. Trust the code and `git log`, not that file's
"deliberately not carried over" list, for current status.

**Gen 2 rebuild — Session 1 (Foundation) is complete.** What landed:
- Rebrand: `wxt.config.ts` name/description/homepage, new icon set
  (`public/icons/icon-{32,64,128}.png` + `public/icons/icon.svg` source,
  a faceted-prism mark on an indigo→violet gradient).
- `styles/tokens.css`: shared design tokens (color incl. dark mode, spacing,
  radius, shadow, type scale). Not consumed by any surface yet as of this
  Session 1 writeup — adoption started in Session 3 (popup/bubble/options,
  see that section below) and continues through Session 5.
- Real test harness: Vitest (`modules/**/*.test.ts`, run via `npm test`) and
  a formalized Playwright E2E smoke suite (`tests/e2e/run.mjs`, run via
  `npm run test:e2e`) replacing the old ad-hoc scratchpad-script pattern.
- CI (`.github/workflows/ci.yml`): typecheck → unit tests → build → E2E,
  on every push/PR.
- `npm audit`: 18 vulnerabilities → 0. Root cause was an unused direct
  `web-ext` devDependency (nothing imported it; `wxt` already bundles its
  own `web-ext-run` for Firefox builds) plus an outdated `wxt` — removed the
  former, bumped the latter to 0.21.2.
- Biome added for lint/format (`npm run lint` / `lint:fix`). Auto-fixed
  formatting/import-order across the repo; **~115 pre-existing lint findings
  remain untouched on purpose** (mostly `a11y/useButtonType` in
  popup/old-popup/options/bubble — files Sessions 3-4 rewrite anyway, so
  fixing them now would be wasted work). Not part of the CI gate yet.

See the plan file's Session 1 section for the full task list and rationale.
One consequence worth knowing: bumping `wxt` regenerated `.wxt/tsconfig.json`
with `noUncheckedIndexedAccess: true` newly biting in ~20 places across
`modules/providers/*`, `modules/config/store.ts`, `modules/languages/index.ts`
— all fixed with real (not `!`-suppressed) undefined handling, see git log
for the commit. If a future `wxt` bump does this again, same drill: don't
suppress, handle the real possibly-empty-array/match case.

**Gen 2 rebuild — Session 2 (Engine mechanics + provider architecture) is
complete.** What landed:
- `modules/providers/descriptors.ts`: single source of truth for what
  providers exist and what they can do (roles, key requirement, feature-
  detection, batching hint). `registry.ts`'s dispatch and gating now derive
  from it. `schema.ts`'s three service enums are still hand-maintained
  literal tuples on purpose — see that file's header comment for why
  deriving them loses zod's literal-type inference.
- `modules/providers/llm.ts`: OpenAI-compatible chat-completions provider
  (base URL/key/model, all user-supplied). Extends the shared `Service`
  class rather than a bespoke request loop. Sends numbered segments in one
  prompt, expects a JSON array of translations back, and joins/splits
  multi-string pieces (grouped nodes) with a U+241F separator so the
  response round-trips back to the right DOM nodes.
- `modules/providers/builtin.ts`: on-device translation via Chrome's
  `Translator`/`LanguageDetector` APIs, feature-detected
  (`typeof Translator !== 'undefined'`). **Verified against the real API**,
  not just mocked — Playwright's bundled Chromium (v151+) genuinely has
  `Translator.availability()` and it correctly returns `'downloadable'` for
  an untested language pair. No API key, no `customServices` entry.
- `modules/page-translator/grouping.ts`: groups sibling text nodes sharing
  a block ancestor into one piece for providers with a `batchingHint`
  (currently just `llm`) — extracted from `translateLoop.ts` as its own
  pure(-ish) function specifically so it's unit-testable (see Testing).
  MT providers and `builtin` keep today's exact one-node-per-piece shape.
- `modules/providers/types.ts`'s `Service.handleRequest` now retries a
  single piece individually (once) if a batch response comes back short —
  "checking," benefits every `Service`-based provider, matters most for
  the LLM path where truncated/malformed JSON is a real risk.
- Config versioning (`CONFIG_SCHEMA_VERSION`/`configMigrations`/
  `applyConfigMigrations` in `schema.ts`, wired into `store.ts`'s
  `initConfig`) — infrastructure only, `configMigrations` ships empty since
  this session's own schema changes were purely additive. Add to it (and
  bump the version) the next time a stored value's *shape* changes, not
  just its allowed values.
- Options page: functional (not yet restyled — Session 3) fields for the
  LLM provider and an availability indicator for the on-device one, plus
  both added as real, selectable options in the page/text translator
  service dropdowns. The 6 other UI files with per-provider `Record`/array
  literals (bubble, hover-tooltip ×1, selection-popup, old-popup, popup,
  translate-text) got minimal `llm`/`builtin` label entries added just to
  keep those `Record<Config['...Service'], string>` types satisfied — they
  are **not** in the curated quick-switch service lists yet; that's a
  Session 3/4 UI call, not an oversight.
- **Real end-to-end verification, not just unit tests**: a scratch
  Playwright run (local mock LLM HTTP server + local static test page,
  same pattern as the "Testing" section below) confirmed the full pipeline
  — content-script DOM collection → block-boundary grouping (2 separate
  `<p>` elements correctly sent as 2 separate numbered segments, not
  merged) → `sendMessage`/`onMessage` → `registry.ts` → `llm.ts`'s real
  HTTP request in the correct format → response parsed → DOM updated with
  the translated text. Not committed as a permanent test (ad hoc, matches
  the established pattern for real round-trip checks — see "Testing"), but
  it ran and passed.
- **Streaming decision (the plan's "Speed" task)**: not implemented.
  `llm.ts` asks the model for one JSON array covering the whole batch, so
  a token stream would arrive as an incomplete/invalid JSON document until
  the very end — reconstructing partial per-piece results from that
  reliably would need meaningfully more parsing complexity than the payoff
  justifies right now. Revisit if a future session redesigns the prompt/
  response contract around a streamable format (e.g. one JSON object per
  line, flushed as each segment completes).
- New dev dependencies: `playwright` (Session 1), `fake-indexeddb`
  (polyfills `indexedDB` so `Service`/`translationCache`-touching code is
  testable in Vitest's Node environment) and `happy-dom` (real DOM for
  `grouping.ts`'s block-ancestor-walking tests, via a per-file
  `// @vitest-environment happy-dom` pragma — the main suite stays on the
  faster `node` environment by default).

**Gen 2 rebuild — Session 3 (Full primary UI redesign) is complete.** What
landed:
- `entrypoints/old-popup/` deleted entirely, along with the `useOldPopup`
  config key and its swap logic in `background.ts`'s `resetBrowserAction`
  — one toolbar popup now, not two. `grep`-clean, see git log for the commit.
- `entrypoints/popup/App.tsx` + `App.css` rebuilt on `styles/tokens.css` —
  new header (brand mark + status pill showing detected source language or
  "Translated"), primary CTA button, quick-language pills, a distinct
  service-switcher row (was easy to mis-read as a 4th language pill before
  a deliberate fix — keep it visually separate from the language pills if
  you touch this again), toggle-style rows instead of plain checkboxes.
  Every handler/state signal is unchanged from before this session — only
  the render/markup and CSS changed.
- `components/bubble/FloatingBubble.tsx`: only the inline `<style>` block
  and the `.head` icon/subtitle markup changed (indigo/violet gradient
  replacing blue, "Prism" replacing "TWP · FullPage"). The pointer-event/
  drag/edge-docking math (`solidOnMount`, `applyState`/`previewAt`/
  `positionPanel`) is byte-for-byte untouched, verified both by code review
  and a real hover/drag check via Playwright. Token values are **duplicated
  inline**, not `@import`'d — this component renders inside a closed shadow
  root injected into arbitrary third-party pages, which can't reach the
  extension's own `styles/tokens.css` by a relative path. Keep the two in
  sync by hand if the palette ever changes.
- `entrypoints/options/App.tsx` + `App.css`: restructured from one ~700-line
  scroll into 6 ARIA-tabbed panels (General, Page, Selection & hover, Voice,
  Dictionary, Advanced) — `role="tablist"`/`"tab"`/`"tabpanel"`, arrow-key
  navigation (Home/End too), automatic activation per the ARIA APG pattern.
  All 10 original `<Section>`s preserved verbatim, just regrouped — no
  settings lost. The LLM/on-device provider fields (Advanced tab) got a
  distinct highlighted card style (`.aiHighlight`), not just plain fields.
- **Real visual verification, not just "it compiles"**: every rebuilt
  surface (popup light/dark, bubble idle/hover on a real local test page,
  options all-tabs/dark-mode, keyboard tab navigation) was screenshotted via
  an ad hoc Playwright run and actually looked at before calling this done
  — including catching and fixing a real issue (the service-switcher chip
  originally looked like a 4th language pill) that `tsc`/tests alone would
  never have caught.
- `tests/e2e/run.mjs` gained per-entrypoint structural `check` callbacks
  (popup's `.primaryBtn` exists; options has exactly 6 `role="tab"` and 6
  `role="tabpanel"` elements) and a toolbar-icon popup-assignment check
  (`chrome.action.getPopup({})` resolves to `.../popup.html`) confirming
  the old-popup removal didn't break `resetBrowserAction`.
- Lint findings: 66 (end of Session 2) → 53 errors. Still not part of the
  CI gate; remaining findings are concentrated in surfaces Session 4
  touches (hover-tooltip, mobile-popup, selection-popup, the standalone
  windows).

**Gen 2 rebuild — Session 4 (Trust, permissions, sync, remaining surfaces) is
complete.** What landed:
- **Permissions scoped down**, `wxt.config.ts`: `host_permissions` went from
  an unconditional `['<all_urls>']` to `['https://www.deepl.com/*']` only
  (the DeepL live-tab bridge's fixed, narrow need); everything else is
  `activeTab` (the on-demand "translate this page" gesture — toolbar click,
  hotkey, context menu) plus an optional `<all_urls>` grant a user can turn
  on from Settings → Page ("Enable automatic translation on all sites") for
  the old always-on/floating-bubble/hover experience.
- **Two real, non-obvious bugs found only by running the built extension**,
  not by code review or `tsc` — both now documented in the relevant file so
  they aren't rediscovered the hard way again:
  1. A *static* `content_scripts` manifest entry's own `matches` pattern
     grants injection rights independent of `host_permissions` — scoping
     down `host_permissions` alone did nothing while
     `content-main.content.ts` stayed on the default `'manifest'`
     registration. Fixed by moving it to `registration: 'runtime'` and
     dynamically registering it only once the optional permission is
     actually granted, via `browser.scripting.registerContentScripts`/
     `unregisterContentScripts` in the new
     `modules/messaging/contentMainRegistration.ts` (`syncContentMainRegistration()`,
     called on background startup and on `permissions.onAdded`/`onRemoved`).
  2. WXT itself then unconditionally folds a `registration: 'runtime'`
     script's own `matches` field into the *mandatory* `host_permissions`
     array at build time (documented WXT behavior, not a bug in WXT — see
     `node_modules/wxt/dist/core/utils/manifest.mjs`) — silently putting
     `<all_urls>` right back as a mandatory permission. Caught by a
     diagnostic logging `chrome.permissions.contains()` on a brand-new
     profile and getting `true` when it should have been `false`. Fixed by
     omitting `matches` entirely from `content-main.content.ts`'s
     `defineContentScript()` — the real matches pattern lives solely in
     `contentMainRegistration.ts`'s own argument to
     `registerContentScripts()`, evaluated only once the real permission is
     held. See that file's header comment for the full account.
  3. A third, Firefox-specific gap found the same way: `optional_host_permissions`
     is an MV3-only manifest key — WXT silently strips it from the Firefox
     MV2 build with **no fallback**, which would have made the "automatic
     translation" opt-in permanently ungrantable on Firefox with no error,
     just a checkbox that quietly did nothing. Fixed by making
     `wxt.config.ts`'s `manifest` a per-browser function
     (`(env) => ({...})`) that puts `<all_urls>` into `optional_permissions`
     instead for Firefox (MV2 has one unified permissions/optional_permissions
     array, no separate host-permission concept) — verified by diffing the
     actual built `manifest.json` for both targets, not assumed.
- **On-demand injection fallback** for the `activeTab` gesture path:
  `modules/messaging/ensureContentScript.ts`'s `sendEnsuringContentScript()`
  — tries the message send, and on a "no receiver" error injects
  content-main via `browser.scripting.executeScript` then retries (up to 6x,
  150ms apart). Used by every direct-to-tab message send in `background.ts`
  (toolbar/context-menu/hotkey paths) and the three `sendMessage` call sites
  in `entrypoints/popup/App.tsx` that need the content script live.
- **Verification depth**: confirmed via real Playwright runs against the
  actual built extension, not just unit tests — (a) a fresh profile shows
  zero `chrome.permissions.contains()` grant and zero content-script
  injection (checked via the shadow-DOM bubble host element being absent —
  a content-script-set `window` property does NOT leak to the page's
  main-world `window`, since content scripts run in an isolated JS world;
  learned this checking the wrong thing first), (b) a build copy with
  `<all_urls>` statically pre-granted (simulating post-grant state, since
  `chrome.permissions.request()`'s native dialog cannot be driven by
  headless Playwright — same category of limitation already documented
  below for toolbar-icon clicks) shows `syncContentMainRegistration()`
  self-registering on startup, the bubble mounting, and a full LLM
  translate round-trip (mock server, real grouped request, real DOM
  update) working end to end. Direct calls to `registerContentScripts()`
  *without* the permission genuinely fail (Chrome enforces this for real,
  confirmed, not just declaratively) — the negative case is as solid as
  the positive one.
- **Cross-device settings sync**, `modules/config/schema.ts` +
  `modules/config/store.ts`: a new `SYNCED_CONFIG_KEYS` allowlist (not
  "everything except an exclusion list" — `chrome.storage.sync`'s hard caps,
  100KB total / 8KB per item / 512 items, make a silent overflow a real
  failure mode to design around) covers language preferences, always/never-
  translate lists, service choice, and behavior toggles. Deliberately kept
  local: `customServices` (API keys — sync is an explicit privacy/scope
  choice, not a default), the unbounded per-host/per-term maps
  (`fpSourceLangByHost`, `fpBubbleByHost`, `customDictionary` — real quota
  risk for a heavy user), `hotkeys` (overwritten from this device's own
  `chrome.commands.getAll()` every load — syncing it would just get
  immediately stomped), and a few device-local facts/trade-offs
  (`originalUserAgent`, `installDateTime`, `fpBubblePos`, `enableDiskCache`,
  `proxyServers`, `deeplConfirmed`, `showReleaseNotes`, `popupPanelSection`).
  `storageKeyFor()` picks `sync:`/`local:` per key, feature-detected
  (`!!browser.storage?.sync`) so it degrades to all-local rather than
  throwing if sync is genuinely unavailable. A one-time
  `migrateLocalSettingsToSyncIfNeeded()` copies an *existing* install's
  already-configured local values into sync on first upgrade, so enabling
  sync doesn't look like a silent reset to defaults. `set()` now catches
  (rather than lets propagate) a storage-write failure — the realistic
  trigger is a sync quota overflow on a pathological always/never-translate
  list, and degrading to "this write didn't sync" beats an unhandled
  rejection breaking whatever UI action triggered it. Verified against the
  real built extension (not just unit tests): synced keys land in
  `chrome.storage.sync`, `hotkeys`/`customServices` correctly stay in
  `chrome.storage.local`, and the migration-complete flag sets once.
- **Telemetry**: explicitly asked, explicitly declined by the user
  ("Skip it for now") — not implemented, not a gap.
- **Every remaining surface restyled** onto `styles/tokens.css`'s palette:
  `components/hover-tooltip/` (both variants), `components/mobile-popup/`,
  `components/selection-popup/`, and the three standalone windows
  (`entrypoints/translate-text/`, `translate-document/`,
  `improve-translation/`). The three content-script/shadow-DOM components
  (tooltips, mobile popup, selection popup) can't `@import` the token file
  for the same reason `FloatingBubble.tsx` can't (closed shadow root on
  arbitrary third-party pages) — their palette is duplicated inline,
  matching `FloatingBubble.tsx`'s established Session 3 pattern exactly
  (same hex values), not reinvented. The three standalone windows
  (real top-level extension pages, not shadow DOM) `@import` the token file
  directly, same as the popup/options pattern from Session 3. Verified with
  real screenshots (light + dark) of all three standalone windows, plus a
  real-page check that the selection-popup button renders correctly
  (confirmed visually; the follow-up click-to-open-panel check hit a
  headless-Playwright shadow-root-piercing limitation unrelated to this
  session's CSS-only changes — not pursued further, matching this
  codebase's existing precedent for headless-automation gaps around native
  browser chrome).
- Lint: 53 (end of Session 3) → 45 errors after `npm run lint:fix` on the
  touched files (mostly formatting; a few genuine a11y findings remain,
  same "not part of the CI gate yet, don't feel obligated to fix unrelated
  debt" policy as prior sessions).

**Gen 2 rebuild — Session 5 (Release engineering + final polish) is
complete. Gen 2 itself is now done.** What landed:
- **Firefox build validated in CI**: a new parallel `build-firefox` job in
  `.github/workflows/ci.yml` runs `npm run build:firefox`, checks the
  expected entrypoint files exist in `.output/firefox-mv2`, then packages
  and uploads both the Firefox zip and its required AMO-review sources zip
  as build artifacts. `build:firefox` existed as an npm script since the
  skeleton rewrite but was never checked anywhere automated before this.
  No Firefox E2E — this repo's Playwright harness only drives Chromium
  (see "Testing" below); a real Firefox runtime smoke test is a further
  follow-up, not bundled in here.
- **Bundle-size guardrail tightened**: 5MB generous placeholder → 3MB
  (~1.3x the real ~2.32MB build), now that Sessions 2-4's actual growth is
  known. Still generous enough for legitimate growth, tight enough to
  catch a real regression.
- **Release engineering via Changesets**: `@changesets/cli` added
  (`npm run changeset` to add one, `npm run version` to apply pending ones
  — see `.changeset/README.md`). Replaces hand-edited version bumps and
  `CHANGELOG.md` entries going forward; this session used it for real to
  produce the actual 11.0.0 → 12.0.0 (major) bump marking Gen 2 complete —
  not just scaffolded and left untested. `CHANGELOG.md` gained a note
  marking where auto-generated entries begin vs. the older hand-written
  skeleton-rewrite history below it. Per-browser packaged zip artifacts
  (task 2's other half) piggyback on the CI jobs above via the existing
  `wxt zip`/`zip:firefox` scripts — no separate release workflow was
  added, since there's no established tag/release process yet to gate one
  on; every CI run now produces downloadable Chrome/Firefox zips as
  artifacts, which is the concrete win without inventing release-tagging
  ceremony nobody asked for.
- **A real regression found by the audit pass, not just a formality**:
  "Always translate this site" / "Always translate from {lang}" (popup)
  and the equivalent always-translate/hover-translate list editors
  (options page) saved their config setting correctly but — under Session
  4's activeTab-by-default permission model — silently had no effect on a
  *future* page load unless the optional `<all_urls>` grant happened to
  already be on, since nothing can run automatically without either that
  grant or a fresh user gesture. Fixed in `entrypoints/popup/App.tsx`
  (`requestAlwaysOnPermission()`) and `entrypoints/options/App.tsx`
  (`addInArray`'s `KEYS_NEEDING_ALWAYS_ON_PERMISSION` check): both now
  call `browser.permissions.request(ALL_SITES_PERMISSION)` synchronously
  inside the triggering click handler when enabling one of these settings
  — imported from the shared `ALL_SITES_PERMISSION` constant in
  `modules/messaging/contentMainRegistration.ts` (previously redeclared
  locally in `options/App.tsx`; now there's one source of truth). Verified
  for real against the built extension: both calls are reachable and
  don't throw a context/gesture error when triggered by a genuine
  Playwright click (the native permission dialog itself still can't be
  driven headlessly — same documented limitation as everywhere else this
  applies).
  **Important platform-level finding from investigating this**: `chrome.permissions`
  (both `.request()` *and the read-only* `.contains()`) is entirely
  inaccessible from content-script contexts — confirmed against Chrome's
  own content-script API-access docs, not assumed. This is why
  `components/mobile-popup/MobilePopup.tsx`'s equivalent "always translate
  from lang" menu item could **not** get the same fix — it runs inside
  content-main, a content script, and has no path to either request or
  even check that permission on its own. Left as a documented gap (see
  that file's comment) rather than a broken/no-op fix. If this needs
  solving properly later, it requires a message round trip through
  `background.ts` for the *read* (`.contains()`), and accepting that the
  *write* (`.request()`) can only ever happen from a real extension page —
  there is no way to gesture-trigger it from a content script, full stop.
- **Full regression pass**: `tsc`, unit tests (47), both builds, the full
  Playwright E2E suite, and `npm audit` all clean after every change this
  session, including after the permission-gap fix. Further attempts to
  headlessly simulate a genuine toolbar-icon/context-menu user gesture
  (to test the on-demand `activeTab` injection path completely end-to-end
  from a fresh, fully-ungranted profile) hit the same well-established
  Playwright limitation already documented in prior sessions — not a new
  finding, so not re-litigated at length here; Session 4's unit tests
  (`ensureContentScript.test.ts`) plus the real Chrome-enforcement checks
  already done there remain the verification of record for that mechanism.
- **Docs**: this section, plus `founder.md` (rewritten to describe the
  finished Gen 2 product, not a work-in-progress), `ROADMAP.md` (Tier 4
  items 13/14 marked done), and the plan file's Session 5 section all
  updated.

**Gen 2 is complete as of this session** — see the plan file's session map
for the full arc (Sessions 1-5) and this file's "Current status" sections
above for what each one actually shipped.

## Known gaps / next things to look at
- **Release notes aren't wired into the new options page.** `showReleaseNotes`
  is still a config key (`modules/config/schema.ts`) but nothing renders
  release notes anywhere in the new UI. The old `options/release-notes/en.html`
  content was deleted along with the rest of the dead vanilla-JS tree (see
  below) — if porting this, pull it from git history (`git show
  d7da732:options/release-notes/en.html` or earlier).
- **Toolbar-icon translated/original state swap** (the old
  `icon-32-translated.png`) isn't wired up — cosmetic, not urgent.
- **Mobile popup's "Always translate from {lang}" can't prompt for the
  always-on permission** the way the equivalent popup/options controls do
  (Session 5) — it runs in a content-script context, where `chrome.permissions`
  is entirely inaccessible (not just gesture-restricted). See
  `components/mobile-popup/MobilePopup.tsx`'s comment on
  `toggleAlwaysTranslateFromLang` for the full explanation and what a real
  fix would require (a message round trip through `background.ts`).
- **No real Firefox E2E/runtime smoke test** — Session 5 added a Firefox
  *build* validation job to CI, but this repo's Playwright harness only
  ever drives Chromium (see "Testing" below). A genuine Firefox runtime
  check is still open.
- **"Always translate" reported broken on Orion (iOS)** by a real user —
  the manual "translate this page" button works, but sites/languages added
  to an always-translate list don't auto-translate on a later visit; the
  user has to click every time. Diagnosed from the symptom, not verified
  against the actual browser (no way to test Orion/iOS from this
  environment): Orion is WebKit-based, not Chromium, and its WebExtension
  implementation most likely supports the older, more fundamental
  `scripting.executeScript` (what the manual-click path uses, via
  `ensureContentScript.ts`) without supporting the newer
  `scripting.registerContentScripts`/`getRegisteredContentScripts`/
  `unregisterContentScripts` trio that `contentMainRegistration.ts`'s
  `syncContentMainRegistration()` needs to keep "always translate" working
  across future page loads with no fresh gesture — exactly matching the
  reported split (button works, "always" doesn't). Session 5 added a
  feature-detection guard there (`if (!browser.scripting?.registerContentScripts) return;`)
  so an unsupported browser degrades to "always translate only takes
  effect right after a click" instead of throwing an unhandled rejection
  out of a fire-and-forget background call — but this does not (and can't,
  from the extension side) make the automatic behavior actually work on
  such a browser; there's no MV3-standard alternative mechanism for
  "run this script automatically on future page loads once a permission is
  granted" other than `registerContentScripts` or a static
  `content_scripts` manifest entry (which brings back the Session 4
  install-time-broad-permission problem this whole architecture exists to
  avoid). Safari/WebKit was never a decided target for this project (see
  `ROADMAP.md`) — this is the concrete shape that gap takes in practice.
  **Root cause confirmed** (not just theorized) by comparing against the
  user's own previously-working pre-rewrite fork
  (`twp-fullpage-chrome.zip`, the vanilla-JS TWP-FullPage build this whole
  project started from): its `manifest.json` has unconditional
  `host_permissions: ["<all_urls>"]` plus every content script statically
  declared in `content_scripts` — injected by the browser itself on every
  page load, with zero dependency on `scripting.registerContentScripts` or
  any other dynamic-registration API. That's exactly why it worked
  everywhere including Orion. Presented as an explicit choice — revert to
  that unconditional-access model, add a static fallback (which would
  behaviorally undo the scope-down anyway, per the finding above), or keep
  the current model — **the user chose to keep the privacy-forward
  activeTab-by-default model**, accepting that automatic translation won't
  work on WebKit-based browsers lacking this API. What was added instead:
  `entrypoints/welcome/` (see below), a one-time onboarding page opened via
  `background.ts`'s `runtime.onInstalled` listener (`reason === 'install'`
  only) offering the always-on permission up front, since the user
  reported never finding the equivalent Settings toggle on their own. This
  improves *discoverability* for every user; it does not and cannot fix
  the underlying Orion/WebKit API gap.

## Repo layout

```
entrypoints/         WXT entrypoints — one per browser-visible surface
  background.ts         message router, context menus, commands, popup swap,
                         chrome.alarms keepalive
  offscreen/             chrome.offscreen doc — TTS audio playback lives here
  content-early.content.ts   document_start bootstrap (config/i18n only)
  content-main.content.ts    document_end — page translator, bubble, hover,
                              selection, mobile popup
  content-deepl-bridge.content.ts   scrapes DeepL's own web UI (live-tab bridge,
                                     not a backend API call)
  popup/, options/, improve-translation/, translate-text/,
  translate-document/, welcome/
                         each: index.html + main.tsx (Solid) + App.tsx + App.css
                         (old-popup/ deleted in Gen 2 Session 3 — one popup
                         now, not two). welcome/ is the install-time
                         onboarding page (see "Known gaps" above) — opened
                         once via background.ts's runtime.onInstalled, not
                         a page users navigate to directly

modules/              framework-agnostic domain logic, imported by entrypoints
  config/                zod schema + chrome.storage.local-backed store
                         (schema.ts mirrors the old defaultConfig 1:1 — same
                         ~45 keys, plus a versioning/migration system added
                         in Gen 2 Session 2 — see CONFIG_SCHEMA_VERSION)
  messaging/             protocol.ts (discriminated-union message contracts,
                         via @webext-core/messaging) + tabTarget.ts (shared
                         mainFrameTarget/pageActionTarget helpers — see below)
                         + ensureContentScript.ts (on-demand injection +
                         retry for the activeTab gesture path) +
                         contentMainRegistration.ts (dynamic content-main
                         registration gated on the optional <all_urls>
                         grant) — both added in Gen 2 Session 4, see that
                         section above
  providers/             google.ts, bing.ts, yandex.ts, deepl.ts, libre.ts,
                         llm.ts, builtin.ts, descriptors.ts (provider
                         capability registry), registry.ts, types.ts
  cache/                 IndexedDB translation cache, size-budgeted eviction
  tts/                   offscreen-document client/player
  page-translator/       translateLoop.ts, dedupe, resweep, mutation watcher,
                         grouping.ts (block-context batching for providers
                         that want it) — the highest-risk, most
                         perf-sensitive code in the repo
  languages/             generated language-name tables + code-fixing helpers
  hover/, selection/, platform/

components/            Solid components shared across bubble/popups/options
  bubble/, hover-tooltip/, mobile-popup/, selection-popup/

public/_locales/       i18n message bundles (via @wxt-dev/i18n)
public/icons/           icon-{32,64,128}.png + icon.svg (source) — Prism mark
styles/tokens.css       shared design tokens (Gen 2) — see "Current status"
tests/e2e/run.mjs       formalized Playwright smoke suite (`npm run test:e2e`)
.github/workflows/ci.yml  compile → test → build → e2e, on push/PR
wxt.config.ts          manifest permissions/commands/action/options_ui —
                       WXT does NOT auto-infer most of this from folder
                       structure, it must be declared explicitly
```

## Conventions established during the rewrite

- **Config**: `modules/config/schema.ts` is the source of truth. Same keys,
  same `chrome.storage.local` area as the old extension — existing installs
  upgrade silently. Don't rename or migrate keys without a very good reason.
- **Messaging**: every message is a typed entry in
  `modules/messaging/protocol.ts`. `background.ts` is the single hub for
  provider/TTS/cache messages; content scripts talk to each other and to
  popups directly for page-state stuff.
- **Tab targeting** (`modules/messaging/tabTarget.ts`): when a popup/
  standalone window sends a message to a tab's content script directly,
  use `mainFrameTarget(tabId)` for state/language *queries* (always want one
  deterministic answer from the main frame) and `pageActionTarget(tabId)`
  for translate/restore *actions* (respects the `enableIframePageTranslation`
  config key — broadcast to every frame or just the main frame).
  `background.ts` has its own copy of this same logic for the toolbar-icon/
  context-menu/command paths; keep both in sync if the semantics ever change.
- **No w3.css.** All UI is hand-rolled CSS per entrypoint/component. Dark
  mode is done via `prefers-color-scheme`, not the old `darkMode` config
  key's manual class-toggling (simpler, and the config key still exists for
  compat but isn't read by the new UI — check before assuming it's dead).
- **Upstream-integration carve-outs**: several old-code integrations tied to
  the original author's *own* hosted services were deliberately dropped, not
  overlooked — the PDF-viewer webapp (`pdf.translatewebpages.org` /
  `pdftohtml.translatewebpages.org`), Patreon/donation links. If you're
  porting something and hit one of these, dropping it is consistent with
  prior decisions, not a regression.
- **Dead-code awareness**: some old-code states/branches were provably
  unreachable even in the original (e.g. `pageLanguageState` only ever takes
  `'original'`/`'translated'` — a `"translating"`/`"error"` switch case was
  dead in the old code too). Don't feel obligated to port unreachable states
  just because the old code had a case for them — verify reachability first,
  and say so in the commit message if you drop something for this reason.

## Testing

Real test harness as of Session 1 of the Gen 2 plan — run all of this before
calling anything done:
1. `npm run compile` (`tsc --noEmit`) — must be clean.
2. `npm test` (Vitest, `modules/**/*.test.ts`) — unit tests for
   framework-agnostic logic. Add tests here for new pure-logic modules.
   `tests/setup.ts` polyfills `indexedDB` (via `fake-indexeddb/auto`) for
   the whole suite, so code that imports `modules/cache/translationCache.ts`
   (directly, or transitively via `Service` in `modules/providers/types.ts`)
   is testable without a browser — `modules/providers/types.test.ts` and
   `llm.test.ts` exercise real `Service.translate()` calls this way, with
   `global.fetch` mocked rather than the network itself. For DOM-dependent
   logic (currently just `grouping.ts`, which walks real `parentElement`
   chains), add `// @vitest-environment happy-dom` as the first line of
   that test file rather than switching the whole suite's default
   environment — most tests don't need a DOM and `node` is faster.
3. `npm run build` / `npm run build:firefox` — must succeed; check the
   output file list for expected entrypoint HTML/JS/CSS.
4. **After adding a new entrypoint folder**, run `npx wxt prepare` — this
   regenerates `.wxt/types/paths.d.ts`'s `PublicPath` union, which
   `browser.runtime.getURL()`'s typed overload depends on. `tsc` will fail
   on the new URL string otherwise, even though `wxt build` itself picks up
   new entrypoints fine without it.
5. `npm run test:e2e` (`tests/e2e/run.mjs`) — headless-Chromium Playwright
   smoke test, loads the real unpacked `.output/chrome-mv3` build and opens
   every entrypoint HTML file as a tab, asserting no page errors. Requires
   `npm run build` first.

   **Non-obvious gotcha, cost real debugging time to find**: Playwright's
   `headless: true` launches `chrome-headless-shell`, a stripped binary with
   **no extension support at all** — `--load-extension` silently does
   nothing and no service worker ever registers. The fix (already in
   `tests/e2e/run.mjs`, don't rediscover it): launch with `headless: false`
   but pass `'--headless=new'` as an arg — this makes Playwright pick the
   full Chrome binary while Chrome itself still runs headless.
6. All of the above run in CI (`.github/workflows/ci.yml`) on every push/PR
   — plus, since Session 5, a parallel `build-firefox` job (build + expected-
   entrypoints check + zip, no E2E — see "Known gaps") and zip-artifact
   uploads for both browsers from the main job.
7. For a real content-script round trip (not just structural/no-exception
   checks — `chrome.tabs.query({active:true})` in a plain Playwright tab
   resolves to that tab itself, not a page under test), serve a local static
   test page (`python3 -m http.server`) rather than relying on outbound
   network access, which isn't reliable in this environment.
8. `npm run lint` (Biome) — not yet part of the CI gate; pre-existing debt
   tracked, see "Current status" above. Run `npm run lint:fix` for new code
   you write, but don't feel obligated to fix unrelated pre-existing
   findings while working on something else.
9. **Releasing** (Session 5, automated in a later follow-up): `npm run
   changeset` to record a change (picks a bump type + writes a short
   description to `.changeset/`), `npm run version` to apply every pending
   changeset — bumps `package.json` and prepends a `CHANGELOG.md` entry in
   one step. Once that bump lands on `main`/a `claude/**` branch and CI
   passes, `.github/workflows/release.yml` takes over automatically: it
   builds both browser targets, packages the zips (+ the Firefox sources
   zip AMO review needs), and publishes a GitHub Release with them
   attached — gated on `workflow_run` watching CI's own conclusion, so a
   broken build never gets auto-released just because `package.json`
   changed. Idempotent (checks `gh release view` for that version first),
   so it's safe to run on every CI completion, not just version-bump
   commits.
   - **Currently in changesets prerelease ("beta") mode** — entered via
     `npx changeset pre enter beta`, so `npm run version` produces versions
     like `12.1.0-beta.0` (auto-incrementing the trailing number each
     time) instead of a plain `X.Y.Z`, and every such release is marked
     "Pre-release" on GitHub (the workflow detects the `-` and adds
     `--prerelease`). Chrome's manifest `version` field can't hold a
     prerelease suffix (numeric dot-segments only) — WXT already handles
     this natively: `version` gets simplified to the plain `12.1.0` for
     store validity, and `version_name` (Chrome-only; Firefox doesn't get
     this field) carries the full `12.1.0-beta.0` string so it's still
     visible in `chrome://extensions` and the Web Store listing. When this
     project is ready to leave beta, run `npx changeset pre exit` once —
     after that, `npm run version` goes back to producing plain `X.Y.Z`
     releases.

A real bug was caught by exactly this loop: a Solid.js native `<select>`
bound via `value={signal()}` silently stopped resetting after a user pick,
because the reset called `setSignal()` with the *same* value the signal
already held (Object.is bail-out — Solid saw no change, so the DOM-sync
effect never re-ran, even though the actual `<select>` element's value had
changed from user interaction that bypassed the signal). Fixed by resetting
that particular control imperatively via a ref instead of through signal
state. Worth remembering for any other "pick one, then reset to a
placeholder" UI in this codebase.

## Updating founder.md

`founder.md` is a plain-language, non-technical description of what this
extension does and how it's built, meant for someone who isn't a developer.
**Whenever you make a user-visible or architecturally meaningful change,
update `founder.md` to match** — new features, dropped features, or a
meaningful change in how something works. Keep the tone and level of that
file consistent (simple, concrete, no jargon) rather than reverting it
toward a technical changelog. If a change is purely internal (refactor, bug
fix with no visible behavior change), it doesn't need a founder.md update —
use judgment.
