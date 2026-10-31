#!/usr/bin/env bash
set -euo pipefail
WD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
. "$WD_ROOT/scripts/lib/toolchain.sh"
wd_platform
mkdir -p "$WD_ROOT/.cache/downloads" "$WD_ROOT/.runtime"
if ! mkdir "$WD_ROOT/.cache/build.lock" 2>/dev/null; then echo 'A source build or check is already running.' >&2; exit 1; fi
trap 'rmdir "$WD_ROOT/.cache/build.lock" 2>/dev/null || true' EXIT
wd_prepare_go
wd_prepare_node
(cd "$WD_ROOT/backend" && "$WD_GO" test ./... && "$WD_GO" test -tags testcredentials ./internal/vault -run TestDevelopmentCredentialsMarkDisposableVault && "$WD_GO" test -race ./... && "$WD_GO" vet ./...)
rm -f "$WD_ROOT/.cache/frontend-deps"
(cd "$WD_ROOT/frontend" && npm ci --cache "$WD_ROOT/.cache/npm" --no-audit --no-fund && npm test && npm run lint)
