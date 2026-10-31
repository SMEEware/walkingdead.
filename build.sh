#!/usr/bin/env bash
set -euo pipefail
WD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$WD_ROOT/scripts/lib/toolchain.sh"
wd_platform
WD_TARGET="$WD_OS/$WD_ARCH"
WD_VERSION=0.1.0-dev
WD_HEADLESS=0
WD_START=0
WD_START_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --headless) WD_HEADLESS=1; shift ;;
    --start) WD_START=1; shift ;;
    --target|--version) [ "$#" -ge 2 ] || { echo "$1 requires a value." >&2; exit 1; }; if [ "$1" = --target ]; then WD_TARGET="$2"; else WD_VERSION="$2"; fi; shift 2 ;;
    --) shift; WD_START_ARGS=("$@"); break ;;
    -h|--help) echo 'Usage: ./build.sh [--headless] [--target linux/amd64] [--version VERSION] [--start] [-- startup options]'; exit 0 ;;
    *) echo "Unknown build option: $1" >&2; exit 1 ;;
  esac
done
case "$WD_TARGET" in linux/amd64|linux/arm64|darwin/amd64|darwin/arm64|windows/amd64|windows/arm64) ;; *) echo 'Unsupported target.' >&2; exit 1 ;; esac
case "$WD_VERSION" in ''|*[!a-zA-Z0-9._-]*) echo 'Version must contain only letters, numbers, dots, underscores, and hyphens.' >&2; exit 1 ;; esac
if [ "$WD_START" = 1 ] && [ "$WD_TARGET" != "$WD_OS/$WD_ARCH" ]; then echo 'Cannot start a binary built for another platform.' >&2; exit 1; fi
mkdir -p "$WD_ROOT/.cache/downloads" "$WD_ROOT/.runtime" "$WD_ROOT/dist"
if ! mkdir "$WD_ROOT/.cache/build.lock" 2>/dev/null; then echo 'Another build owns .cache/build.lock. Remove it only after confirming that build has stopped.' >&2; exit 1; fi
WD_TMP=""
wd_cleanup() { [ -z "$WD_TMP" ] || rm -rf "$WD_TMP"; rmdir "$WD_ROOT/.cache/build.lock" 2>/dev/null || true; }
trap wd_cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
wd_prepare_go
WD_TAGS=""
if [ "$WD_HEADLESS" = 0 ]; then
  wd_prepare_node
  export NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_URL=/api/v1
  WD_LOCK_HASH="$(wd_hash "$WD_ROOT/frontend/package-lock.json")"
  WD_STAMP="$WD_ROOT/.cache/frontend-deps"
  if [ ! -d "$WD_ROOT/frontend/node_modules" ] || [ ! -f "$WD_STAMP" ] || [ "$(cat "$WD_STAMP")" != "$WD_LOCK_HASH $(node --version)" ]; then
    rm -f "$WD_STAMP"
    (cd "$WD_ROOT/frontend" && npm ci --cache "$WD_ROOT/.cache/npm" --no-audit --no-fund)
    printf '%s\n' "$WD_LOCK_HASH $(node --version)" > "$WD_STAMP"
  fi
  (cd "$WD_ROOT/frontend" && npm run build)
  [ -f "$WD_ROOT/frontend/out/index.html" ] || { echo 'Frontend static export is missing.' >&2; exit 1; }
  rm -rf "$WD_ROOT/backend/internal/webui/dist"
  mkdir -p "$WD_ROOT/backend/internal/webui/dist"
  cp -R "$WD_ROOT/frontend/out/." "$WD_ROOT/backend/internal/webui/dist/"
  WD_TAGS=webui
fi
WD_PLATFORM="${WD_TARGET/\//_}"
WD_TMP="$(mktemp -d "$WD_ROOT/.cache/release.XXXXXX")"
WD_PACKAGE="$WD_TMP/$WD_PLATFORM"
mkdir -p "$WD_PACKAGE"
export CGO_ENABLED=0 GOOS="${WD_TARGET%/*}" GOARCH="${WD_TARGET#*/}"
WD_EXE=""
WD_STARTERS="start.sh"
[ "$GOOS" != windows ] || { WD_EXE=.exe; WD_STARTERS="start.ps1 start.bat"; }
(cd "$WD_ROOT/backend" && "$WD_GO" build -trimpath -tags "$WD_TAGS" -ldflags "-s -w -X main.version=$WD_VERSION" -o "$WD_PACKAGE/wdd$WD_EXE" ./cmd/wdd && "$WD_GO" build -trimpath -ldflags "-s -w -X main.version=$WD_VERSION" -o "$WD_PACKAGE/wd$WD_EXE" ./cmd/wd)
for WD_ITEM in $WD_STARTERS; do cp "$WD_ROOT/scripts/release-$WD_ITEM" "$WD_PACKAGE/$WD_ITEM"; done
cp "$WD_ROOT/LICENSE" "$WD_ROOT/THIRD_PARTY_NOTICES.md" "$WD_PACKAGE/"
cp "$WD_ROOT/backend/api/openapi.json" "$WD_PACKAGE/"
cp "$WD_ROOT/README.md" "$WD_PACKAGE/README.md"
WD_FILES="wdd$WD_EXE wd$WD_EXE $WD_STARTERS LICENSE THIRD_PARTY_NOTICES.md README.md openapi.json"
(cd "$WD_PACKAGE" && for WD_ITEM in $WD_FILES; do printf '%s  %s\n' "$(wd_hash "$WD_ITEM")" "$WD_ITEM"; done > SHA256SUMS)
WD_DEST="$WD_ROOT/dist/$WD_PLATFORM"
mkdir -p "$WD_DEST"
WD_FLAVOR=""
[ "$WD_HEADLESS" = 0 ] || WD_FLAVOR=-headless
if [ "$GOOS" = windows ]; then
  WD_ARCHIVE="walkingdead-$WD_VERSION-$WD_PLATFORM$WD_FLAVOR.zip"
  command -v zip >/dev/null 2>&1 || { echo 'Windows archives require zip.' >&2; exit 1; }
  (cd "$WD_TMP" && zip -qr "$WD_ARCHIVE" "$WD_PLATFORM")
else
  WD_ARCHIVE="walkingdead-$WD_VERSION-$WD_PLATFORM$WD_FLAVOR.tar.gz"
  COPYFILE_DISABLE=1 tar -czf "$WD_TMP/$WD_ARCHIVE" -C "$WD_TMP" "$WD_PLATFORM"
fi
touch "$WD_DEST/.build-in-progress"
for WD_ITEM in $WD_FILES SHA256SUMS; do
  mv -f "$WD_PACKAGE/$WD_ITEM" "$WD_DEST/$WD_ITEM"
done
mv -f "$WD_TMP/$WD_ARCHIVE" "$WD_ROOT/dist/$WD_ARCHIVE"
rm -f "$WD_DEST/.build-in-progress"
printf 'Built %s (%s) in %s\n' "$WD_VERSION" "$WD_TARGET" "$WD_ROOT/dist/$WD_PLATFORM"
wd_cleanup
trap - EXIT
if [ "$WD_START" = 1 ]; then exec "$WD_ROOT/dist/$WD_PLATFORM/start.sh" --data-dir "$WD_ROOT/data" ${WD_START_ARGS[@]+"${WD_START_ARGS[@]}"}; fi
