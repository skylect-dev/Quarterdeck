#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$APP_DIR/dist"
TARGET_DIR="$DIST_DIR/quarterdeck"

mkdir -p "$DIST_DIR"
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR/data"

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required"
  exit 1
fi

rsync -a \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'data/' \
  --exclude 'dist/' \
  --exclude '.env' \
  "$APP_DIR/" "$TARGET_DIR/"

cp "$APP_DIR/.env.example" "$TARGET_DIR/.env.example"
printf '[]\n' > "$TARGET_DIR/data/linked-directories.json"
printf '{"digests":[],"ghcrNegative":[]}\n' > "$TARGET_DIR/data/digest-cache.json"

echo "Release bundle created at: $TARGET_DIR"
