#!/usr/bin/env bash
set -euo pipefail
WD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "$#" -gt 0 ]; then
  echo 'Usage: ./scripts/test-build.sh'
  exit 1
fi
"$WD_ROOT/build.sh"
. "$WD_ROOT/scripts/lib/toolchain.sh"
wd_platform
if ! mkdir "$WD_ROOT/.cache/build.lock" 2>/dev/null; then echo 'Another source build or check is running.' >&2; exit 1; fi
trap 'rmdir "$WD_ROOT/.cache/build.lock" 2>/dev/null || true' EXIT
wd_prepare_go
mkdir -p "$WD_ROOT/.cache/test-bin"
(cd "$WD_ROOT/backend" && CGO_ENABLED=0 GOOS="$WD_OS" GOARCH="$WD_ARCH" "$WD_GO" build -trimpath -tags webui,testcredentials -ldflags '-X main.version=test' -o "$WD_ROOT/.cache/test-bin/wdd" ./cmd/wdd)
echo 'Built .cache/test-bin/wdd for local development and disposable smee/password123 tests. Never distribute this test binary or its data.'
