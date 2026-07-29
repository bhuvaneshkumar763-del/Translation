# Working on this repo — read this first

This is **TWP - FullPage (modified)**, a browser extension that translates
web pages in place. It's a heavily-patched fork of the open-source
"Traduzir Páginas Web" (TWP) extension, currently mid-way through a full
rewrite: the original ~16,000-line vanilla-JS/`importScripts` codebase is
being replaced with **WXT + TypeScript + Solid.js**, module by module, with
100% feature parity as the hard requirement (nothing dropped without saying
so explicitly, in writing, in this repo).

If you're picking this up cold: skim this file, then `CHANGELOG.md` (the
phase-by-phase rewrite history and what's known to still be missing), then
look at `git log` on this branch for the granular story.

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
- Both toolbar popups — the current one (`entrypoints/popup`) and the
  legacy select-menu-driven skin (`entrypoints/old-popup`), swapped at
  runtime via the `useOldPopup` config key.
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

## Known gaps / next things to look at

- **Release notes aren't wired into the new options page.** `showReleaseNotes`
  is still a config key (`modules/config/schema.ts`) but nothing renders
  release notes anywhere in the new UI. The old `options/release-notes/en.html`
  content was deleted along with the rest of the dead vanilla-JS tree (see
  below) — if porting this, pull it from git history (`git show
  d7da732:options/release-notes/en.html` or earlier).
- **Toolbar-icon translated/original state swap** (the old
  `icon-32-translated.png`) isn't wired up — cosmetic, not urgent.
- No automated test suite exists. See Testing below for how verification has
  actually been done instead.

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
  popup/, old-popup/, options/, improve-translation/, translate-text/,
  translate-document/
                         each: index.html + main.tsx (Solid) + App.tsx + App.css

modules/              framework-agnostic domain logic, imported by entrypoints
  config/                zod schema + chrome.storage.local-backed store
                         (schema.ts mirrors the old defaultConfig 1:1 — same
                         ~45 keys, no migration, no renames)
  messaging/             protocol.ts (discriminated-union message contracts,
                         via @webext-core/messaging) + tabTarget.ts (shared
                         mainFrameTarget/pageActionTarget helpers — see below)
  providers/             google.ts, bing.ts, yandex.ts, deepl.ts, libre.ts,
                         registry.ts, types.ts
  cache/                 IndexedDB translation cache, size-budgeted eviction
  tts/                   offscreen-document client/player
  page-translator/       translateLoop.ts, dedupe, resweep, mutation watcher —
                         the highest-risk, most perf-sensitive code in the repo
  languages/             generated language-name tables + code-fixing helpers
  hover/, selection/, platform/

components/            Solid components shared across bubble/popups/options
  bubble/, hover-tooltip/, mobile-popup/, selection-popup/

public/_locales/       i18n message bundles (via @wxt-dev/i18n)
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

There's no automated test suite. Verification loop used throughout this
rewrite:
1. `npx tsc --noEmit` — must be clean.
2. `npx wxt build` — must succeed; check the output file list for expected
   entrypoint HTML/JS/CSS.
3. **After adding a new entrypoint folder**, run `npx wxt prepare` — this
   regenerates `.wxt/types/paths.d.ts`'s `PublicPath` union, which
   `browser.runtime.getURL()`'s typed overload depends on. `tsc` will fail
   on the new URL string otherwise, even though `wxt build` itself picks up
   new entrypoints fine without it.
4. Headless-Chromium smoke tests via Playwright, run ad hoc (no committed
   spec files — there's no test runner wired into `package.json` yet).
   Pattern that works in this environment:
   ```js
   import { chromium } from 'playwright';
   const context = await chromium.launchPersistentContext(userDataDir, {
     headless: true,
     executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', // check the actual versioned dir under /opt/pw-browsers
     args: [
       `--disable-extensions-except=/home/user/Translation/.output/chrome-mv3`,
       `--load-extension=/home/user/Translation/.output/chrome-mv3`,
       '--headless=new',
     ],
   });
   let worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
   const extId = worker.url().split('/')[2];
   // then context.newPage().goto(`chrome-extension://${extId}/<entrypoint>.html`)
   // and/or worker.evaluate(() => chrome.action.getPopup({})) to inspect background state directly
   ```
   `playwright` isn't a project dependency — install it ad hoc into the
   scratchpad dir (`npm install playwright --no-save`) rather than adding it
   to `package.json` unless a real test suite is being set up.
   Known limitation: opening an entrypoint HTML file as a plain tab (rather
   than as a real toolbar popup) means `chrome.tabs.query({active:true})`
   resolves to *that tab itself*, not whatever page you meant to test
   against — fine for structural/no-exception checks, not for a true
   round-trip through a content script. Real popup-window simulation isn't
   well supported by Playwright's extension testing today.
5. For a real content-script round trip, serve a local static test page
   (`python3 -m http.server`) rather than relying on outbound network
   access, which isn't reliable in this environment.

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
