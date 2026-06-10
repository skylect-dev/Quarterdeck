#!/usr/bin/env bash
export PREFER_GHCR=true
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${DATA_DIR:-$SCRIPT_DIR/data}"
SERVICE_NAME="quarterdeck"
SKIP_SYSTEMD_PROMPT_FILE="$SCRIPT_DIR/.skip-systemd-prompt"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

# ── Systemd install/update prompt ────────────────────────────────────────────
if [[ -f "$SERVICE_PATH" ]]; then
  if [[ ! -f "$SKIP_SYSTEMD_PROMPT_FILE" ]]; then
    echo ""
    echo "A systemd service for this app is already installed."
    read -rp "Update it now (re-runs install-systemd.sh)? [y/N/never] " _sd_choice
    _sd_choice="$(echo "${_sd_choice:-n}" | tr '[:upper:]' '[:lower:]')"
    if [[ "$_sd_choice" == "never" ]]; then
      touch "$SKIP_SYSTEMD_PROMPT_FILE"
      echo "  OK — won't ask again. Delete .skip-systemd-prompt to re-enable."
    elif [[ "$_sd_choice" == "y" || "$_sd_choice" == "yes" ]]; then
      echo "  Running installer..."
      sudo bash "$SCRIPT_DIR/install-systemd.sh"
    fi
  else
    echo ""
    echo "A systemd service for this app is installed (prompt suppressed)."
  fi

  echo "Use systemd to manage Quarterdeck instead of running ./start.sh directly:"
  echo "  sudo systemctl status $SERVICE_NAME"
  echo "  sudo systemctl restart $SERVICE_NAME"
  exit 0
fi

if [[ ! -f "$SKIP_SYSTEMD_PROMPT_FILE" ]]; then
  echo ""
  echo "No systemd service detected for this app."
  read -rp "Install it as a systemd service? [y/N/never] " _sd_choice
  _sd_choice="$(echo "${_sd_choice:-n}" | tr '[:upper:]' '[:lower:]')"
  if [[ "$_sd_choice" == "never" ]]; then
    touch "$SKIP_SYSTEMD_PROMPT_FILE"
    echo "  OK — won't ask again. Delete .skip-systemd-prompt to re-enable."
  elif [[ "$_sd_choice" == "y" || "$_sd_choice" == "yes" ]]; then
    echo "  Running installer..."
    sudo bash "$SCRIPT_DIR/install-systemd.sh"
    echo "Systemd service installed and started."
    echo "Use: sudo systemctl status $SERVICE_NAME"
    exit 0
  fi
  echo ""
fi
# ─────────────────────────────────────────────────────────────────────────────

mkdir -p "$DATA_DIR"

cd "$SCRIPT_DIR"
exec env DATA_DIR="$DATA_DIR" npm start