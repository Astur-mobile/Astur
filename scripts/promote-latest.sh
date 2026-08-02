#!/usr/bin/env bash
#
# Point the `latest` dist-tag at a version that is already published.
#
# Needed when a release went out under the wrong tag, or when promoting a
# release candidate. `npm dist-tag` triggers 2FA, so this cannot run
# unattended — expect a browser prompt on the first package.
#
# Usage:
#   ./scripts/promote-latest.sh 0.5.0-beta.3
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/promote-latest.sh <version>"
  exit 1
fi

if ! npm whoami >/dev/null 2>&1; then
  echo "Not authenticated to npm. Run: npm login"
  exit 1
fi

PKGS=(
  @astur-mobile/protocol
  @astur-mobile/core
  @astur-mobile/android
  @astur-mobile/ios
  @astur-mobile/cli
  astur-mobile
  create-astur
  @astur-mobile/test
)

for pkg in "${PKGS[@]}"; do
  echo "==> $pkg@$VERSION -> latest"
  npm dist-tag add "$pkg@$VERSION" latest
done

echo
echo "Verify:"
for pkg in "${PKGS[@]}"; do
  echo "  npm view $pkg dist-tags"
done
