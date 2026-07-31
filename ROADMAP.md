# Roadmap: from gen-2 skeleton to a radically new gen-2 product

`CLAUDE.md` and `CHANGELOG.md` cover the skeleton rewrite (vanilla JS →
WXT + TypeScript + Solid, 100% feature parity). That rewrite is **done**.

This file is the next layer: what needs to change — beyond just swapping the
skeleton — for this to genuinely be several generations ahead of the
original TWP fork, and set up so *future* upgrades are cheap instead of
painful. Findings below are grounded in the current code, not generic
advice — file/line references included so they're checkable.

Ranked by priority. Re-rank as items land or new gaps are found; don't let
this file go stale the way the old `CHANGELOG.md` did.

> **This roadmap has been turned into an executable multi-session plan.**
> See `/Users/jb/.claude/plans/so-whats-the-plan-polished-elephant.md` for
> the session-by-session breakdown (~5 hours each) — that file is now the
> operational source of truth for sequencing; this file stays as the
> grounded "why" behind each item and gets its checkboxes updated as
> sessions land.
>
> **Gen 2 is complete as of Session 5.** Every Tier 1-4 item below is
> either done or explicitly, deliberately declined (telemetry — the user
> was asked and said skip it). Tier 5 remains a genuine forward-looking
> wishlist, not something Gen 2 promised.
>
> **Post-Session-5 update:** item 5's permission scope-down was reverted
> after shipping — real-world use on Orion (iOS) showed automatic
> translation permanently breaking on browsers lacking a newer MV3 API,
> with no fallback for those users. See that item and `CLAUDE.md`'s
> "Permission model: reverted to unconditional access" for the full story.

## Tier 1 — Fix before this looks like a real gen-2 product

1. ✅ **DONE (Session 1).** Manifest description/name/homepage rebranded to
   Prism; see `wxt.config.ts`.
2. ✅ **DONE (Session 1).** New icon set + brand direction — see
   `public/icons/icon.svg` and the plan file's "New brand direction" note.
3. ✅ **DONE (Session 1).** Vitest + formalized Playwright E2E suite + CI
   (`.github/workflows/ci.yml`). See `CLAUDE.md`'s "Testing" section.
4. ✅ **DONE (Session 1).** `npm audit`: 18 → 0 (removed unused `web-ext`,
   bumped `wxt` to 0.21.2).

## Tier 2 — Trust & permissions

5. ⤺ **TRIED (Session 4), REVERTED (post-Session-5).** `host_permissions`
   was scoped down from `['<all_urls>']` to `['https://www.deepl.com/*']`
   (DeepL bridge only), with `activeTab` + on-demand injection for the core
   gesture path and an optional `<all_urls>` grant for the old always-on
   experience. A real user's "always translate" only ever worked right
   after a fresh click on Orion (WebKit-based, iOS) — never automatically
   — because the optional-grant path depends on `scripting.registerContentScripts`,
   an MV3 API Orion apparently doesn't support, and Orion has no native
   fallback to grant the equivalent access another way. Confirmed against
   the user's own previously-working pre-rewrite fork (unconditional
   `host_permissions` + static `content_scripts`, no dynamic registration
   dependency at all) — reverted to match it exactly, by the user's
   explicit choice over keeping the scoped model with automatic
   translation permanently broken on such browsers. See `CLAUDE.md`'s
   "Permission model: reverted to unconditional access" section for the
   full account, including the two non-obvious bugs found while first
   building the scoped model (a static `content_scripts` entry granting
   injection independent of `host_permissions`; WXT folding a
   `registration:'runtime'` script's `matches` back into mandatory
   `host_permissions`) and the Firefox-specific gap
   (`optional_host_permissions` is MV3-only) found along the way — all
   still worth knowing if this trade-off is ever revisited.
6. **No error visibility.** Still open — explicitly asked about and
   explicitly declined by the user in Session 4 ("skip it for now"), not
   silently dropped. Revisit if the user wants it later.

## Tier 3 — The actual "radically new" differentiators

This is where gen-2-vs-gen-1 should actually show, not just parity with a
newer skeleton.

7. ✅ **DONE (Session 2).** LLM-based translation provider
   (`modules/providers/llm.ts`, OpenAI-compatible) plus a bonus not
   originally in this list: an on-device provider
   (`modules/providers/builtin.ts`, Chrome's built-in Translator API —
   found via research during Session 2's planning, not part of the
   original audit). Both are context/batch-aware via the new
   `grouping.ts`/batching-hint mechanism, not sentence-by-sentence.
   `customDictionary` glossary-injection into the LLM prompt is **not**
   done yet — a real follow-up, not silently dropped.
8. **Reduce reliance on unofficial endpoints.** Still open. Google/Bing/
   Yandex here are scraped/reverse-engineered, which is inherently fragile
   (breaks whenever the provider changes internals — this is exactly the
   kind of thing the old extension's history is full of patches for) and
   sits in ToS gray area. The new `llm`/`builtin` providers are official-
   API-based alternatives, but the specific asks here (Google Cloud
   Translation, Azure Translator, DeepL's real API as first-class options)
   aren't done.
9. ✗ **TRIED (Session 4), REMOVED — do not retry via `chrome.storage.sync`.**
   Cross-device settings sync shipped as a `SYNCED_CONFIG_KEYS` allowlist
   routing language prefs, translate lists, and service choice to
   `chrome.storage.sync`. It was the **second** cause of the user's
   "always translate does nothing" report: on WebKit-based engines that
   area can be present-but-non-functional, or readable in extension pages
   and empty in content scripts, so the options page showed a site in the
   always-translate list while the page translator read the same key and
   got nothing — no error anywhere. Deleted entirely at the user's
   explicit choice over a dual-write alternative; export/import in
   Settings → Backup is the supported way to move settings between
   devices. See `CLAUDE.md`'s "storage.sync removed" section, and the
   warning comment on `storageKeyFor()` in `modules/config/store.ts`,
   before revisiting this. If it is ever revisited, the design constraint
   is that **`chrome.storage.local` must remain the value every context
   actually reads**, with sync only ever mirroring on top of it.
10. ✅ **DONE (Session 2).** Provider capability registry —
    `modules/providers/descriptors.ts`. `registry.ts`'s dispatch/gating now
    derives from it; `schema.ts`'s three service enums are still
    hand-maintained by design (see that file's header comment).

## Tier 4 — Foundational hygiene (makes everything above cheaper)

11. ✅ **DONE (Session 1).** Biome added (`npm run lint`/`lint:fix`).
    Pre-existing findings in files slated for Session 3-4 rewrites were left
    untouched on purpose — see `CLAUDE.md`'s "Current status".
12. ✅ **DONE (Session 2).** Config migration/versioning —
    `CONFIG_SCHEMA_VERSION`/`configMigrations`/`applyConfigMigrations` in
    `schema.ts`, wired into `store.ts`. Ships with zero real migrations
    (this session's schema changes were purely additive) — infrastructure
    for the next change that isn't, not a completed migration itself.
13. ✅ **DONE (Session 5).** Cross-browser builds verified in CI — a
    parallel `build-firefox` job in `.github/workflows/ci.yml` builds,
    checks expected entrypoints, and packages the Firefox target on every
    push/PR. No Firefox *E2E* yet (Playwright here only drives Chromium) —
    a real Firefox runtime smoke test remains open. Safari isn't addressed;
    not decided as a target.
14. ✅ **DONE (Session 5).** Release engineering — `@changesets/cli` added
    (`npm run changeset` / `npm run version`) replacing hand-edited version
    bumps and `CHANGELOG.md` entries; used for real to produce the
    11.0.0 → 12.0.0 bump marking Gen 2 complete. Per-browser zip artifacts
    now build and upload automatically in CI via the existing `wxt zip`
    scripts (no separate release-tagging workflow — nothing to gate one on
    yet).

## Tier 5 — Expansion, once the above lands

15. Per-site/per-domain custom glossary (today `customDictionary` is one
    flat global map — `schema.ts:59`).
16. Side-by-side original/translated reading view (not just in-place
    replacement).
17. ✅ **DONE (Sessions 1 + 3 + 4).** Full rebrand away from the TWP
    name/icon lineage: new name/icon/manifest strings (Session 1), every
    primary UI surface — popup, floating bubble, options (Session 3) —
    and every remaining surface — hover-tooltip (both variants),
    mobile-popup, selection-popup, and the three standalone windows
    (Session 4) — all now share the same Prism visual identity. The
    old-popup alternate skin (a direct TWP-lineage artifact) is deleted.
    Nothing left on this item.

## Not on this list on purpose

Things already handled by the skeleton rewrite and not worth re-doing:
i18n coverage (43 locale bundles, solid), the page-translation engine's
dedupe/resweep/mutation-watching design, the disk cache's size-budgeted
eviction, and the messaging/tab-targeting contracts in
`modules/messaging/`. See `CLAUDE.md` for what's already good.
