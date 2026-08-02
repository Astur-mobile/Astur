#!/usr/bin/env bash
#
# Publish every public workspace package, in dependency order.
#
# Order matters: protocol has no internal deps, core needs protocol, the
# platform drivers need core, and so on. Publishing out of order leaves a
# window where a freshly published package cannot be installed because its
# sibling is not on the registry yet.
#
# `--tag next` is not optional for a prerelease. The README badges read the
# `next` dist-tag, and publishing without it would additionally move `latest`
# onto a beta — which is what every `npm i astur-mobile` would then resolve to.
#
# Usage:
#   npm login
#   ./scripts/publish-npm.sh --dry-run   # inspect the tarballs first
#   ./scripts/publish-npm.sh
set -euo pipefail

DRY=""
[ "${1:-}" = "--dry-run" ] && DRY="--dry-run"

if ! npm whoami >/dev/null 2>&1; then
  echo "Not authenticated to npm (the token in ~/.npmrc may have expired)."
  echo "Run: npm login"
  exit 1
fi

echo "==> publishing as $(npm whoami)"

npm run build
npm test

for pkg in protocol core android ios cli astur-mobile create-astur test; do
  echo "==> packages/$pkg"
  npm publish --workspace "packages/$pkg" --tag next --access public $DRY
done

echo
echo "Done. Verify with:"
echo "  npm view astur-mobile dist-tags"
echo "  npm view @astur-mobile/test version"
