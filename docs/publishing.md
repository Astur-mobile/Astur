# Publishing

Astur is intended to be released as an Apache-2.0 open source npm-first project.

Project attribution:

- license: Apache License 2.0
- author: Amr Salem
- copyright: 2026 Amr Salem and Astur contributors

## Package Strategy

Astur should use a Playwright-style split: one primary test package and one CLI package, with internal runtime packages published under the `@astur-mobile` scope.

Recommended user install:

```bash
npm install -D @astur-mobile/test astur-mobile
```

Why not one large package:

- test code should depend on the stable fixture/assertion API, not directly on CLI internals
- the CLI carries inspector/codegen, scaffolding, app upload, and native-agent lifecycle concerns
- Android and iOS platform packages can evolve independently while keeping the public test API stable
- npm provenance, package files, and native-agent assets are easier to audit per package

Why not a separate inspector package yet:

- users expect `npx astur-mobile codegen` to work from the same CLI that runs `doctor`, `devices`, and `test`
- the inspector depends on the same runtime and platform drivers as the CLI
- a separate `@astur-mobile/inspector` package should wait until there is an embeddable web server or Electron app API that external tools need directly

Initial public packages:

| Package | Public role |
| --- | --- |
| `@astur-mobile/test` | Main user-facing Playwright Test integration: `test`, `expect`, `defineConfig`, locators, fixtures |
| `astur-mobile` | CLI wrapper: `doctor`, `devices`, `init`, `test`, `codegen`, `inspect` |
| `create-astur` | Project scaffolding entry point |
| `@astur-mobile/core` | Runtime contracts and platform-neutral session/locator implementation |
| `@astur-mobile/protocol` | Shared selectors, command types, snapshots, and capabilities |
| `@astur-mobile/android` | Android driver and lifecycle integration |
| `@astur-mobile/ios` | iOS driver and lifecycle integration |
| `@astur-mobile/cli` | CLI implementation consumed by `astur-mobile` |

Native agent packaging decision:

- keep `@astur-mobile/test` and `astur-mobile` as the only packages users normally install
- publish native agent assets inside the platform packages for the alpha: Android APKs under `@astur-mobile/android/assets/agent` and the simulator XCUITest project under `@astur-mobile/ios/assets/ios-xctest-agent`
- make platform drivers resolve packaged agent assets first, then fall back to monorepo source paths for local development
- keep separate `@astur-mobile/android-agent` or `@astur-mobile/ios-agent` packages as a future option only if agent assets need independent release cadence

Before the first public release, verify that a clean external project can install `@astur-mobile/test astur-mobile` and bootstrap both bundled agents without referencing this repository checkout.

## Release Plan

Phase 1, private dry runs:

```bash
npm ci
npm run check
npx vitest run
npm run build
npm pack -w packages/protocol --dry-run
npm pack -w packages/core --dry-run
npm pack -w packages/android --dry-run
npm pack -w packages/ios --dry-run
npm pack -w packages/test --dry-run
npm pack -w packages/cli --dry-run
npm pack -w packages/astur-mobile --dry-run
npm pack -w packages/create-astur --dry-run
```

Phase 2, public prerelease:

Use the release workflow with `tag=next`. It publishes only the selected public workspaces with npm provenance.

Use `next` until the API is stable enough for `latest`.

Phase 3, stable release:

```bash
npm version <patch|minor|major> --workspaces
```

Then use the release workflow with `tag=latest`.

Phase 4, post-release validation:

```bash
npm create astur@latest
npm install -D @astur-mobile/test astur-mobile
npx astur-mobile doctor
npx astur-mobile codegen --help
npx astur-mobile test --help
```

## GitHub Actions Plan

CI should run on every pull request and push to `main`:

```text
checkout
setup Node.js LTS
npm ci
npm run check
npm run build
npx vitest run
```

Recommended workflow files:

- `.github/workflows/ci.yml`: typecheck, build, and unit tests on pull requests and pushes
- `.github/workflows/release.yml`: manual npm publish with provenance
- `.github/workflows/nightly-mobile.yml`: optional scheduled Android/iOS smoke tests on hosted or self-hosted runners

Release should be manual at first:

```text
workflow_dispatch(tag = next|latest, version = optional)
checkout
setup Node.js with registry-url=https://registry.npmjs.org
npm ci
npm run check
npm run build
npx vitest run --coverage
npm pack selected public workspaces --dry-run
npm publish selected workspaces --access public --provenance --tag <tag>
```

Required repository secrets:

- `NPM_TOKEN`

Required GitHub workflow permissions for npm provenance:

- `contents: read`
- `id-token: write`

Before publishing, verify:

- package names are available on npm
- GitHub repository name is available
- license and NOTICE text are final
- npm organization `astur-mobile` is owned by the project (the `@astur-mobile` scope)
- unscoped `astur` is occupied on npm and blocks an `astur` org, so the scope is `@astur-mobile` and the CLI wrapper is the unscoped `astur-mobile`
- package READMEs are expanded for each package
- bundled Android and iOS agent assets resolve from installed npm packages, not only from the source monorepo
- unit tests and branch coverage for changed driver/agent paths are updated
- npm package metadata includes author, license, exports, types, files, and publish access
- the release workflow is first tested with `npm publish --dry-run` or a `next` prerelease

## Repository Layout

Astur is split across the `Astur-mobile` GitHub organization so the docs site can
deploy and monetize independently and examples track the published packages, not
the monorepo checkout:

| Repository | Role | Publishes |
| --- | --- | --- |
| `Astur-mobile/Astur` | Library monorepo (packages + release pipeline) | npm (the only publishing repo) |
| `Astur-mobile/astur-demoApp` | Expo/React Native demo app | the demo `.app` / `.apk` / `.ipa` artifacts the docs reference |
| `Astur-mobile/astur-boilerplate` | Starter Playwright projects | nothing; depends on published `astur-mobile` + `@astur-mobile/test` |
| `Astur-mobile/astur-docs` | Astro/Starlight docs site | the docs site (own deploy + sponsorship CTA) |

`docs/*.md` in this repo stays the source of truth; the docs repo syncs them with
`docs-site/scripts/sync-docs.mjs`. Examples in this repo use
`npm --prefix .. exec astur-mobile` for local development, but published examples
must use the plain `npx astur-mobile …` form so they work against the npm
release.

## Brand, Copyright, and Anti-Theft

The license stays **Apache-2.0** — the same choice as Playwright, Appium, and
Selenium (WebdriverIO and Cypress use MIT). A permissive license is the
industry norm for automation tooling and is the most adoption-friendly, but it
**cannot** stop others from using or forking the work commercially. Those
projects do not protect their work with the license; they protect it with
**trademark + open core**, and Astur does the same:

- **Trademark** the "Astur" name and logo (registered or common-law). Forks may
  reuse the code but must use their own name. Governed by
  [`TRADEMARK.md`](../TRADEMARK.md); Apache-2.0 explicitly grants no trademark
  rights.
- **`NOTICE`** carries the copyright and the trademark clause and ships in every
  package.
- **Contributor License Agreement** (CLA bot) so the project retains ownership
  and relicensing rights over outside contributions.
- Keep source repositories **private**; publish compiled `dist`. The iOS Swift
  XCUITest agent necessarily ships as source (Xcode compiles it on the user's
  Mac), so trademark + license are its protection.
- **npm provenance** (`id-token: write`) cryptographically ties each package to
  the GitHub build, preventing impersonated releases.

## Monetization

- **Open core (the Cypress model):** the client libraries stay free Apache-2.0;
  a proprietary **Astur Cloud** (device farm, parallel orchestration, reporting
  dashboards) is sold separately and is not covered by the open-source license.
- **Sponsorship:** GitHub Sponsors via `.github/FUNDING.yml` (Stripe Connect
  onboarding required), optionally Open Collective or Polar.sh surfaced on the
  docs site. Add `FUNDING.yml` to each public repo so the Sponsor button appears
  everywhere.
