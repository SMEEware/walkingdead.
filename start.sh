#!/usr/bin/env bash
set -euo pipefail
WD_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$WD_ROOT/build.sh" --start -- "$@"
