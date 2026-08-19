# Contributing to Astur

Thanks for helping improve Astur! This guide keeps it short.

## Setup

```bash
npm ci          # install workspaces
npm run build   # tsc -b across packages
npm test        # vitest run
```

You'll also need the platform SDKs for the area you touch — see
[docs/prerequisites.md](docs/prerequisites.md).

## Where things live

- `packages/` — the shippable code (core, android, ios, test, cli, …)
- `agents/` — native agent sources (Kotlin UIAutomator, Swift XCUITest)
- `docs/` — user guides (canonical source)
- `examples/` — runnable sample suites
- `tests/` — unit/contract tests

## Workflow

1. Open an issue first for anything non-trivial so we can agree on the approach.
2. Branch from `main`.
3. Keep changes focused. If you change behavior, add or update a test in `tests/`.
4. If it's user-facing, update the matching page in `docs/`.
5. Run `npm run check` and `npm test` before pushing.
6. Use clear, conventional commit messages (`feat:`, `fix:`, `docs:`, `chore:`).
7. Open a PR describing what changed and why.

## Translating the docs

The docs site is bilingual: English at the root, Arabic under `/ar/`. Starlight
falls back to English for any page without a translation, so a page can be added
at a time and the site stays whole in between — a missing translation is never a
dead link.

To translate a page:

1. Copy the English source, e.g. `docs/cli.md` → `docs/ar/cli.md`, and translate
   the body. Keep the same file name; that is how the two are paired.
2. Add its Arabic `title` and `description` to the `arabic` map in
   `docs-site/scripts/sync-docs.mjs`. A page without an entry there is not
   published in Arabic, even if the file exists.
3. Run `npm run docs:build` and confirm it still reports no broken links.

Conventions that keep the two versions readable:

- **Leave technical terms in English.** Product, API and tool names —
  `toHaveScreenshot`, `XCUITest`, `Metro`, `WebView`, `Flutter`, `React Native`,
  `Android`, `iOS` — are what these things are called in Arabic technical
  writing too. Translating them makes a page harder to scan, not easier.
- **Never translate code, flags, paths or output.** Code blocks are shown
  left-to-right even on RTL pages, and comments inside a snippet may be
  translated where they are prose.
- **Keep headings parallel with the English page** so the two structures match
  and cross-links between them keep working.
- Anchor links must point at the *Arabic* heading text on Arabic pages, e.g.
  `[الاعتراض](#الاعتراض-غير-متاح-بعد)`. The link checker in `docs:build`
  catches this.

RTL styling lives at the bottom of `docs-site/src/styles/astur.css`. Prose
mirrors; code, paths and CLI output stay left-to-right.

## License

By contributing, you agree your contributions are licensed under the project's
[Apache-2.0 license](LICENSE). "Astur" is a trademark — see
[TRADEMARK.md](TRADEMARK.md).
