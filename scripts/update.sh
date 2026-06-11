#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BRANCH="${QUARTERDECK_UPDATE_BRANCH:-main}"

cd "$APP_DIR"

if [[ ! -d .git ]]; then
  echo "This command requires a git checkout in $APP_DIR"
  exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Missing required command: git"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "Missing required command: npm"
  exit 1
fi

echo "Updating repository on branch: $BRANCH"
git fetch --tags origin
if ! git pull --ff-only origin "$BRANCH"; then
  echo "Update failed: git pull was not fast-forward. Resolve local changes and retry."
  exit 1
fi

echo "Installing dependencies..."
if [[ -f package-lock.json ]]; then
  npm ci --omit=dev
else
  npm install --omit=dev
fi

if systemctl list-unit-files | grep -q '^quarterdeck\.service'; then
  echo "Systemd service detected; reinstalling and restarting service..."
  sudo bash "$APP_DIR/install-systemd.sh"
  echo "Update complete. Check status with: sudo systemctl status quarterdeck"
else
  echo "No systemd service detected."
  echo "Update complete. Start with: ./start.sh"
fi
