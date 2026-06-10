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

## License

By contributing, you agree your contributions are licensed under the project's
[Apache-2.0 license](LICENSE). "Astur" is a trademark — see
[TRADEMARK.md](TRADEMARK.md).
