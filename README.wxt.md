# Prism — AI Page Translator

A browser extension that translates web pages in place, built with
[WXT](https://wxt.dev), TypeScript, and [Solid](https://www.solidjs.com).
Started as a fork of the open-source "Traduzir Páginas Web" (TWP) extension
and has since been rewritten and rebuilt into its own product.

- **Non-technical overview**: see [`founder.md`](./founder.md) — what the
  extension does, in plain language, kept up to date with every
  user-visible change.
- **Working on this repo**: see [`CLAUDE.md`](./CLAUDE.md) — architecture,
  conventions, the full engineering history, and the "Testing" section
  below is a summary of it.
- **What's changed release to release**: see [`CHANGELOG.md`](./CHANGELOG.md).
- **Forward-looking roadmap**: see [`ROADMAP.md`](./ROADMAP.md).

## Development

```sh
npm install
npm run dev            # Chrome, with hot reload
npm run dev:firefox    # Firefox, with hot reload
```

## Testing

Run before considering any change done — see `CLAUDE.md`'s "Testing"
section for the full rationale behind each step:

```sh
npm run compile   # tsc --noEmit
npm test          # Vitest unit tests
npm run build     # production build (also: npm run build:firefox)
npm run test:e2e  # Playwright smoke suite against the real built extension
npm run lint      # Biome — not yet a CI gate, see CLAUDE.md
```

All of the above run in CI (`.github/workflows/ci.yml`) on every push/PR.

## Releasing

This project uses [Changesets](https://github.com/changesets/changesets):

```sh
npm run changeset  # record a change (picks a bump type + description)
npm run version    # apply pending changesets — bumps package.json + CHANGELOG.md
```

Pushing a version bump to `main`/a `claude/**` branch triggers
`.github/workflows/release.yml` once CI passes, which builds both browser
targets and publishes a GitHub Release with the packaged zips attached.
