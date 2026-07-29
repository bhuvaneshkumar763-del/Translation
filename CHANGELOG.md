# Changelog

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
The `useOldPopup` config key correctly swaps the toolbar popup between the
new and old skins at runtime, same as the pre-rewrite code's
`resetBrowserAction`.

**Deliberately not carried over, with reasoning kept in the code/commit
history for each:**
- A handful of upstream-project-specific integrations tied to the original
  author's own hosted services (the PDF-viewer webapp at
  `pdf.translatewebpages.org`, Patreon/donation links) — not general
  extension functionality.
- Toolbar-icon state changes reflecting translated/original (the old
  `icon-32-translated.png` swap) — a small cosmetic gap, not yet wired up.

*(Originally deferred, now built: the old-popup alternate UI at
`popup/old-popup.*` — a legacy visual skin some users prefer over the new
popup — and the three standalone windows `popup/popup-translate-text.*`,
`popup/popup-translate-document.*`, `popup/improve-translation.*`.)*

**Cleanup:** the dead pre-rewrite vanilla-JS source trees (`popup/old-popup.js`,
`popup/improve-translation.js`, `popup/popup-translate-text.js`,
`popup/popup-translate-document.js`, `popup/detect-pdf.js`, and
`options/release-notes/en.html`) have been deleted — they were kept around
only as porting reference and nothing in the built extension imported them.
Pull from git history if any of that content is needed again.

See the git history on this rewrite for the phase-by-phase breakdown (config
+ messaging skeleton, each translation provider, the page-translation engine,
the floating bubble, selection/hover/mobile-popup features, the toolbar
popup + options page, then cache/context-menus/commands/keepalive) and how
each phase was verified.
