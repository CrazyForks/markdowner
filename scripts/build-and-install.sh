#!/usr/bin/env bash
# Compatibility wrapper for the pnpm build install flow.
# Usage:
#   scripts/build-and-install.sh             # release build, install to /Applications
#   scripts/build-and-install.sh --debug     # debug build
#   scripts/build-and-install.sh --no-build  # install an already-built bundle
#   scripts/build-and-install.sh --open      # install and launch the app

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

exec node scripts/build.mjs install "$@"
