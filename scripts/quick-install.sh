#!/usr/bin/env bash
set -euo pipefail

# Paste-friendly installer for Quarterdeck.
# Usage:
#   bash <(curl -fsSL https://raw.githubusercontent.com/skylect-dev/Quarterdeck/main/scripts/quick-install.sh)
# Optional env overrides:
#   QUARTERDECK_REPO_URL=https://github.com/skylect-dev/Quarterdeck.git
#   QUARTERDECK_INSTALL_DIR=$HOME/.local/share/quarterdeck

REPO_URL="${QUARTERDECK_REPO_URL:-https://github.com/skylect-dev/Quarterdeck.git}"
INSTALL_DIR="${QUARTERDECK_INSTALL_DIR:-$HOME/.local/share/quarterdeck}"

for cmd in git bash node npm; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

mkdir -p "$(dirname "$INSTALL_DIR")"
if [[ -d "$INSTALL_DIR/.git" ]]; then
  echo "Updating existing install in $INSTALL_DIR"
  git -C "$INSTALL_DIR" pull --ff-only
else
  echo "Cloning Quarterdeck into $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"

# Interactive setup writes/updates .env, installs dependencies, and installs the quarterdeck shim.
bash ./setup.sh

echo ""
echo "Install complete."
echo "Run with: quarterdeck"
