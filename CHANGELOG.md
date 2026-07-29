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

**Deliberately not carried over, with reasoning kept in the code/commit
history for each:**
- The old-popup alternate UI (`popup/old-popup.*`) — a legacy visual skin,
  not distinct functionality; the new popup covers the same actions.
- The three standalone windows (`popup/popup-translate-text.*`,
  `popup/popup-translate-document.*`, `popup/improve-translation.*`) —
  lower-value auxiliary windows than the popup/options surfaces that got
  built first. Their source is kept in the repo as reference for whoever
  picks this up.
- A handful of upstream-project-specific integrations tied to the original
  author's own hosted services (the PDF-viewer webapp at
  `pdf.translatewebpages.org`, Patreon/donation links) — not general
  extension functionality.
- Toolbar-icon state changes reflecting translated/original (the old
  `icon-32-translated.png` swap) — a small cosmetic gap, not yet wired up.

See the git history on this rewrite for the phase-by-phase breakdown (config
+ messaging skeleton, each translation provider, the page-translation engine,
the floating bubble, selection/hover/mobile-popup features, the toolbar
popup + options page, then cache/context-menus/commands/keepalive) and how
each phase was verified.
