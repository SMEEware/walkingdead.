#!/usr/bin/env bash
set -euo pipefail
WD_RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ ! -f "$WD_RELEASE_DIR/.build-in-progress" ] || { echo 'Release replacement was interrupted or is still running. Complete the source build first.' >&2; exit 1; }
WD_DATA_DIR="$WD_RELEASE_DIR/data"
WD_OWNER=""
WD_PASSWORD_ARGS=()
WD_SERVE_ARGS=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --data-dir|--username|--password-file)
      [ "$#" -ge 2 ] || { echo "$1 requires a value." >&2; exit 1; }
      case "$1" in --data-dir) WD_DATA_DIR="$2" ;; --username) WD_OWNER="$2" ;; --password-file) WD_PASSWORD_ARGS=(--password-file "$2") ;; esac
      shift 2 ;;
    -h|--help) echo 'Usage: ./start.sh [--data-dir PATH] [--username OWNER] [--password-file PATH] [wdd serve options]'; exit 0 ;;
    *) WD_SERVE_ARGS+=("$1"); shift ;;
  esac
done
if ! "$WD_RELEASE_DIR/wdd" initialized --data-dir "$WD_DATA_DIR"; then
  if [ "${WD_PASSWORD_ARGS[1]:-}" = - ]; then
    echo 'Initialize first with wdd init before using stdin for service unlock.' >&2
    exit 1
  fi
  if [ -z "$WD_OWNER" ]; then
    [ -t 0 ] || { echo 'First startup requires --username OWNER and a terminal or --password-file.' >&2; exit 1; }
    read -r -p 'Owner username: ' WD_OWNER
  fi
  "$WD_RELEASE_DIR/wdd" init --data-dir "$WD_DATA_DIR" --username "$WD_OWNER" ${WD_PASSWORD_ARGS[@]+"${WD_PASSWORD_ARGS[@]}"}
  echo 'Store the recovery code above offline. The service now asks for your password again to unlock.' >&2
fi
exec "$WD_RELEASE_DIR/wdd" serve --data-dir "$WD_DATA_DIR" ${WD_PASSWORD_ARGS[@]+"${WD_PASSWORD_ARGS[@]}"} ${WD_SERVE_ARGS[@]+"${WD_SERVE_ARGS[@]}"}
