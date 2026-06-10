#!/usr/bin/env bash
set -euo pipefail

SERVICE_NAME="quarterdeck"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
USER_NAME="${SUDO_USER:-$USER}"
SETUP_SCRIPT="$APP_DIR/setup.sh"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-3099}"
DATA_DIR="${DATA_DIR:-$APP_DIR/data}"
NODE_BIN="$(readlink -f "$(command -v node)")"
NPM_BIN="$(readlink -f "$(command -v npm)")"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
PATH_VALUE="$PATH"

if [[ -z "$NODE_BIN" || -z "$NPM_BIN" ]]; then
  echo "node and npm are required in PATH"
  exit 1
fi

needs_setup="false"
if [[ ! -f "$APP_DIR/.env" ]]; then
  needs_setup="true"
elif ! grep -Eq '^APP_PASSWORD=.+' "$APP_DIR/.env"; then
  needs_setup="true"
fi

if [[ "$needs_setup" == "true" ]]; then
  echo "Running setup to create/update .env and set APP_PASSWORD..."
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != "root" ]]; then
    sudo -u "$SUDO_USER" bash "$SETUP_SCRIPT"
  else
    bash "$SETUP_SCRIPT"
  fi
fi

mkdir -p "$DATA_DIR"

cd "$APP_DIR"
echo "Installing dependencies..."
if [[ -f package-lock.json ]]; then
  "$NPM_BIN" ci --omit=dev
else
  "$NPM_BIN" install --omit=dev
fi

cat <<EOF | sudo tee "$SERVICE_PATH" >/dev/null
[Unit]
Description=Quarterdeck
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$APP_DIR
Environment=PATH=$PATH_VALUE
Environment=NODE_ENV=production
Environment=HOST=$HOST
Environment=PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
ExecStart=$NODE_BIN $APP_DIR/server.js
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

echo "Reloading systemd and enabling service..."
sudo systemctl daemon-reload
sudo systemctl enable --now "$SERVICE_NAME"

echo "Done. Check status with: sudo systemctl status $SERVICE_NAME"
echo "Logs: sudo journalctl -u $SERVICE_NAME -f"
