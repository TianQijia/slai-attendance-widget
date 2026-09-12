#!/bin/sh
SLAI_SCRIPT_DIR=${0%/*}
SLAI_BUNDLE_DIR=$(CDPATH= cd -- "$SLAI_SCRIPT_DIR/.." && pwd)
exec "$SLAI_BUNDLE_DIR/runtime/node" "$SLAI_BUNDLE_DIR/companion/cli.js" autostart "$@"
