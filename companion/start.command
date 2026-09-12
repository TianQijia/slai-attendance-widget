#!/bin/sh
SLAI_SCRIPT_DIR=${0%/*}
SLAI_BUNDLE_DIR=$(CDPATH= cd -- "$SLAI_SCRIPT_DIR/.." && pwd)
if [ ! -f "$SLAI_BUNDLE_DIR/runtime/node" ]; then
  printf '%s\n' 'RUNTIME_MISSING | Stage: launcher | Bundled runtime/node was not found.'
  printf '%s\n' 'Download the Mac companion ZIP (darwin-arm64) from https://github.com/TianQijia/slai-attendance-widget/releases/latest'
  printf '%s\n' 'Extract the entire ZIP. Keep companion and runtime next to each other, then run companion/start.command.'
  printf '%s\n' 'For source development, install Node.js 22+, run npm ci, then npm run start:companion from the repository root.'
  exit 1
fi
exec "$SLAI_BUNDLE_DIR/runtime/node" "$SLAI_BUNDLE_DIR/companion/cli.js" start "$@"
