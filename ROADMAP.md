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

5. **`host_permissions: ['<all_urls>']`** (`wxt.config.ts:22`) is the
   broadest possible grant, with no scoped fallback via
   `optional_host_permissions`. Modern MV3 best practice (and what Chrome
   Web Store review increasingly expects) is `activeTab` by default with
   per-site or on-demand grants. This is both a user-trust issue and a
   store-approval risk, and it's the kind of change that gets harder the
   longer real users depend on the broad grant — better to do it now.
6. **No error visibility.** No telemetry, crash reporting, or logging
   framework anywhere (`grep` for analytics/telemetry/sentry across
   `modules/`, `entrypoints/`, `components/` returns nothing). If a
   provider breaks for real users in the field, there's currently no way
   to find out except a bug report. Doesn't need to be invasive — even
   opt-in, aggregate-only error reporting would be new ground versus the
   old extension, which had none either.

## Tier 3 — The actual "radically new" differentiators

This is where gen-2-vs-gen-1 should actually show, not just parity with a
newer skeleton.

7. **An LLM-based translation provider.** Every current provider
   (`modules/providers/{google,bing,yandex,deepl,libre}.ts`) is either a
   reverse-engineered free endpoint or a plain MT API — none are
   context-aware. A provider backed by an LLM (glossary-aware, tone/
   register control, whole-paragraph context instead of sentence-by-
   sentence) would be a genuine capability jump, not just a rewrite in a
   new language. `customDictionary` (`schema.ts:59`) already exists as a
   flat glossary map — a natural hook for prompt-injected glossary terms.
8. **Reduce reliance on unofficial endpoints.** Google/Bing/Yandex here are
   scraped/reverse-engineered, which is inherently fragile (breaks
   whenever the provider changes internals — this is exactly the kind of
   thing the old extension's history is full of patches for) and sits in
   ToS gray area. Adding official API-key-based options (Google Cloud
   Translation, Azure Translator, DeepL's real API) as first-class,
   documented alternatives — alongside the free ones, not replacing them —
   trades a little user setup friction for real reliability.
9. **Cross-device settings sync.** Config is `chrome.storage.local` only
   (`modules/config/store.ts:9-11`) — a user's target languages, glossary,
   and site rules don't follow them to another machine. `chrome.storage.sync`
   (with its stricter quota) is the low-effort version; a real account/sync
   backend is the ambitious version.
10. **A real provider plugin architecture.** `registry.ts`'s `serviceList`
    is a hardcoded `Map`, and `schema.ts` has three separate hand-maintained
    `z.enum([...])` lists (`pageTranslatorService`, `textTranslatorService`,
    `textToSpeechService`) that must all be edited to add one provider.
    Worth collapsing to a single provider-capability registry so adding
    provider #6 (especially an LLM one) doesn't mean surgery across 4 files.

## Tier 4 — Foundational hygiene (makes everything above cheaper)

11. ✅ **DONE (Session 1).** Biome added (`npm run lint`/`lint:fix`).
    Pre-existing findings in files slated for Session 3-4 rewrites were left
    untouched on purpose — see `CLAUDE.md`'s "Current status".
12. **Config migration/versioning.** `schema.ts` mirrors the old
    extension's ~45 keys 1:1 with **no migration system at all**
    (`schema.ts:7`, `:16`). Every future schema change inherits the same
    "no migration, ever" debt the old code left behind. Worth adding
    versioning now, while the schema is still simple, not after Tier 3
    changes make it bigger.
13. **Verify cross-browser builds in CI.** `build:firefox` exists in
    `package.json` but isn't validated anywhere automated; Safari isn't
    addressed at all. Decide deliberately which browsers are real targets.
14. **Release engineering.** Version bumps and `CHANGELOG.md` are hand-
    edited today. Changesets (or similar) + CI-built, per-browser zip
    artifacts would remove the manual step entirely.

## Tier 5 — Expansion, once the above lands

15. Per-site/per-domain custom glossary (today `customDictionary` is one
    flat global map — `schema.ts:59`).
16. Side-by-side original/translated reading view (not just in-place
    replacement).
17. If going fully independent as a product: full rebrand away from the
    TWP name/icon lineage, not just the `description` string fix in Tier 1.

## Not on this list on purpose

Things already handled by the skeleton rewrite and not worth re-doing:
i18n coverage (43 locale bundles, solid), the page-translation engine's
dedupe/resweep/mutation-watching design, the disk cache's size-budgeted
eviction, and the messaging/tab-targeting contracts in
`modules/messaging/`. See `CLAUDE.md` for what's already good.
