#!/usr/bin/env bash
set -euo pipefail
WD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WD_DEV_BUILD=1
WD_DEV_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --no-build) WD_DEV_BUILD=0; shift ;;
    --listen|--http-address)
      [ "$#" -ge 2 ] || { echo "$1 requires a value." >&2; exit 1; }
      WD_DEV_ARGS+=("$1" "$2"); shift 2 ;;
    -h|--help) echo 'Usage: ./dev.sh [--no-build] [--listen IP:PORT] [--http-address IP:PORT]'; exit 0 ;;
    *) echo "Unknown development option: $1" >&2; exit 1 ;;
  esac
done
if [ "$WD_DEV_BUILD" = 1 ]; then "$WD_ROOT/scripts/test-build.sh"; fi
WD_DEV_BIN="$WD_ROOT/.cache/test-bin/wdd"
[ -x "$WD_DEV_BIN" ] || { echo 'Development binary missing. Run ./dev.sh without --no-build.' >&2; exit 1; }
WD_DEV_DATA="$WD_ROOT/data/development"
if [ ! -e "$WD_DEV_DATA/vault.json" ]; then
  "$WD_DEV_BIN" init --data-dir "$WD_DEV_DATA" --username smee --password-file - <<< 'password123'
fi
echo 'Development console: http://127.0.0.1:3000 (unless overridden). Sign in with smee / password123.'
echo 'Ctrl+C stops the daemon. The encrypted development vault and provider configuration remain in data/development/.'
exec "$WD_DEV_BIN" serve --data-dir "$WD_DEV_DATA" --password-file - --listen 127.0.0.1:3000 ${WD_DEV_ARGS[@]+"${WD_DEV_ARGS[@]}"} <<< 'password123'
