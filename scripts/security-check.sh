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
(cd "$WD_ROOT/backend" && CGO_ENABLED=0 "$WD_GO" run golang.org/x/vuln/cmd/govulncheck@v1.9.0 ./...)
(cd "$WD_ROOT/frontend" && npm ci --cache "$WD_ROOT/.cache/npm" --no-audit --no-fund)
(cd "$WD_ROOT/frontend" && npm audit --omit=dev --audit-level=high && ./node_modules/.bin/audit-ci --config audit-ci.jsonc)
