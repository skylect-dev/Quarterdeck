#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
ENV_EXAMPLE="$APP_DIR/.env.example"

if [[ ! -f "$ENV_EXAMPLE" ]]; then
  echo "Missing $ENV_EXAMPLE"
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$ENV_EXAMPLE" "$ENV_FILE"
  echo "Created .env from .env.example"
fi

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32
    return
  fi

  if command -v node >/dev/null 2>&1; then
    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    return
  fi

  if [[ -r /dev/urandom ]] && command -v od >/dev/null 2>&1; then
    od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
    return
  fi

  echo "Could not generate a secure random secret (openssl/node unavailable)." >&2
  exit 1
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'
}

set_env_value() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(escape_sed_replacement "$value")"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

get_env_value() {
  local key="$1"
  grep -E "^${key}=" "$ENV_FILE" | head -n 1 | cut -d '=' -f 2-
}

current_secret="$(get_env_value "SESSION_SECRET" || true)"
if [[ -z "$current_secret" ]]; then
  new_secret="$(generate_secret)"
  set_env_value "SESSION_SECRET" "$new_secret"
  echo "Generated SESSION_SECRET."
else
  echo "SESSION_SECRET already set; keeping existing value."
fi

current_pass="$(get_env_value "APP_PASSWORD" || true)"
if [[ -n "$current_pass" ]]; then
  echo "APP_PASSWORD is already set. Leave blank to keep the existing password."
fi

while true; do
  if [[ -n "$current_pass" ]]; then
    read -rsp "New APP_PASSWORD (blank = keep current): " pass1
  else
    read -rsp "Set APP_PASSWORD: " pass1
  fi
  echo

  if [[ -z "$pass1" ]]; then
    if [[ -n "$current_pass" ]]; then
      echo "  Keeping existing password."
      break
    else
      echo "Password cannot be empty on first setup."
      continue
    fi
  fi

  read -rsp "Confirm APP_PASSWORD: " pass2
  echo

  if [[ "$pass1" != "$pass2" ]]; then
    echo "Passwords did not match. Try again."
    continue
  fi

  set_env_value "APP_PASSWORD" "$pass1"
  break
done

current_systemd="$(get_env_value "ENABLE_SYSTEMD" || true)"
current_systemd="${current_systemd:-true}"
read -rp "Enable systemd tab and control endpoints? [Y/n, current: ${current_systemd}]: " systemd_choice
systemd_choice="$(echo "${systemd_choice:-y}" | tr '[:upper:]' '[:lower:]')"
if [[ "$systemd_choice" == "n" || "$systemd_choice" == "no" ]]; then
  set_env_value "ENABLE_SYSTEMD" "false"
  echo "  Systemd control disabled."
else
  set_env_value "ENABLE_SYSTEMD" "true"
  echo "  Systemd control enabled."
fi

chmod 600 "$ENV_FILE" || true

echo
echo "Installing dependencies..."
cd "$APP_DIR"
if command -v npm >/dev/null 2>&1; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
else
  echo "npm not found — skipping dependency install. Run 'npm install' manually."
fi

BIN_DIR="${QUARTERDECK_BIN_DIR:-$HOME/.local/bin}"
SHIM_PATH="$BIN_DIR/quarterdeck"
read -rp "Install/update 'quarterdeck' command shim in ${BIN_DIR}? [Y/n]: " shim_choice
shim_choice="$(echo "${shim_choice:-y}" | tr '[:upper:]' '[:lower:]')"
if [[ "$shim_choice" == "n" || "$shim_choice" == "no" ]]; then
  echo
  echo "Skipped command shim install."
else
  mkdir -p "$BIN_DIR"
  cat > "$SHIM_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail
cd "$APP_DIR"
exec ./start.sh
EOF
  chmod +x "$SHIM_PATH"

  echo
  echo "Installed command shim: $SHIM_PATH"
  if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "Add this to your shell profile if needed:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
  fi
fi

echo
echo "Setup complete."
echo "Updated: $ENV_FILE"
echo "Next: run ./start.sh or sudo bash ./install-systemd.sh"
