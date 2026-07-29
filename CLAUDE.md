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

## Known gaps / next things to look at
- **Release notes aren't wired into the new options page.** `showReleaseNotes`
  is still a config key (`modules/config/schema.ts`) but nothing renders
  release notes anywhere in the new UI. The old `options/release-notes/en.html`
  content was deleted along with the rest of the dead vanilla-JS tree (see
  below) — if porting this, pull it from git history (`git show
  d7da732:options/release-notes/en.html` or earlier).
- **Toolbar-icon translated/original state swap** (the old
  `icon-32-translated.png`) isn't wired up — cosmetic, not urgent.

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
  translate-document/
                         each: index.html + main.tsx (Solid) + App.tsx + App.css
                         (old-popup/ deleted in Gen 2 Session 3 — one popup
                         now, not two)

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
6. All of the above run in CI (`.github/workflows/ci.yml`) on every push/PR.
7. For a real content-script round trip (not just structural/no-exception
   checks — `chrome.tabs.query({active:true})` in a plain Playwright tab
   resolves to that tab itself, not a page under test), serve a local static
   test page (`python3 -m http.server`) rather than relying on outbound
   network access, which isn't reliable in this environment.
8. `npm run lint` (Biome) — not yet part of the CI gate; pre-existing debt
   tracked, see "Current status" above. Run `npm run lint:fix` for new code
   you write, but don't feel obligated to fix unrelated pre-existing
   findings while working on something else.

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
