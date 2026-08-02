#!/usr/bin/env bash
#
# Publish every public workspace package, in dependency order.
#
# Order matters: protocol has no internal deps, core needs protocol, the
# platform drivers need core, and so on. Publishing out of order leaves a
# window where a freshly published package cannot be installed because its
# sibling is not on the registry yet.
#
# Publishes to the `latest` dist-tag by default, because that is this project's
# convention while it is pre-1.0 — every 0.5.0-beta.* so far has been `latest`,
# and `npm i astur-mobile` is expected to resolve to the newest beta. Publishing
# to `next` instead leaves `latest` pointing at the previous release and the
# README badges stale.
#
# Pass a tag explicitly if you ever want a release that should NOT become the
# default install, e.g. a release candidate alongside a stable line.
#
# Usage:
#   npm login
#   ./scripts/publish-npm.sh --dry-run     # inspect the tarballs first
#   ./scripts/publish-npm.sh               # publishes to `latest`
#   ./scripts/publish-npm.sh --tag next    # opt out of becoming the default
set -euo pipefail

DRY=""
TAG="latest"
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY="--dry-run"; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac
done

if ! npm whoami >/dev/null 2>&1; then
  echo "Not authenticated to npm (the token in ~/.npmrc may have expired)."
  echo "Run: npm login"
  exit 1
fi

echo "==> publishing as $(npm whoami) to dist-tag: $TAG"

npm run build
npm test

for pkg in protocol core android ios cli astur-mobile create-astur test; do
  echo "==> packages/$pkg"
  npm publish --workspace "packages/$pkg" --tag "$TAG" --access public $DRY
done

echo
echo "Done. Verify with:"
echo "  npm view astur-mobile dist-tags   # latest should be the version you just published"
echo "  npm view @astur-mobile/test version"
