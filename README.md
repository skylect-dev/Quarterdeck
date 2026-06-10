<p align="center">
  <img src="public/icon-readme.png" alt="Quarterdeck icon" width="280" />
  <br />
  <strong>Quarterdeck</strong>
</p>

Simple host-based web UI for managing Docker Compose stacks.

## Install (one line)

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/skylect-dev/Quarterdeck/main/scripts/quick-install.sh)
```

What this does:

- Clones or updates Quarterdeck in `~/.local/share/quarterdeck`
- Runs `./setup.sh` (interactive)
- Lets setup configure `.env`, install dependencies, and optionally install/update the `quarterdeck` command shim

Optional overrides:

- `QUARTERDECK_REPO_URL`
- `QUARTERDECK_INSTALL_DIR`
- `QUARTERDECK_BIN_DIR`

## Manual setup

From the project directory:

```bash
./setup.sh
./start.sh
```

Open:

- `http://127.0.0.1:3099`

Useful one-off overrides:

```bash
PORT=8088 ./start.sh
HOST=0.0.0.0 APP_PASSWORD='change-me' ./start.sh
```

`./setup.sh`:

- Creates `.env` if missing
- Generates `SESSION_SECRET` if empty
- Prompts for `APP_PASSWORD` (blank keeps existing value)
- Prompts whether to enable the Systemd tab/endpoints
- Installs dependencies
- Prompts to install/update the `quarterdeck` command shim

Compose editing/import is available from the Entries tab:

- `Import Compose` button at the top opens a popup for importing into target directory (`merge` or `new`)
- You can browse/select a local compose file from your device, or provide a server file path.
- Target directory can be selected from existing linked directories (dropdown suggestions) or typed manually.
- `Add Services` button on each compose card title opens a popup to paste YAML snippet content (what normally goes under `services:`)
- `Remove` button is available in each service action row (next to start/restart/update/check)

`./start.sh`:

- If `quarterdeck` systemd service exists: optionally updates it, then exits (does not start a second local copy)
- If service does not exist: optionally offers systemd install (`y` / `N` / `never`)
- `never` creates `.skip-systemd-prompt` to suppress future prompts

## Systemd service

```bash
sudo bash ./install-systemd.sh
```

The installer refreshes dependencies on every run and can be used as an upgrade step after pulling changes. If `.env` is missing (or `APP_PASSWORD` is empty), the installer runs `./setup.sh` first.

To expose on your LAN, set `HOST=0.0.0.0` in `.env` and enable auth before installing:

```bash
./setup.sh
# edit HOST/COOKIE_SECURE in .env if needed
sudo bash ./install-systemd.sh
```

Check status:

```bash
sudo systemctl status quarterdeck
```

Follow logs:

```bash
sudo journalctl -u quarterdeck -f
```

## Configuration

Set app auth and runtime options in `.env`:

```bash
APP_PASSWORD=change-me
SESSION_SECRET=replace-this-with-a-long-random-string
SESSION_TTL_HOURS=12
REMEMBER_LOGIN_DAYS=30
COOKIE_SECURE=false
LOGIN_WINDOW_MS=600000
LOGIN_MAX_ATTEMPTS=8
LOGIN_LOCKOUT_MS=900000
ENABLE_SYSTEMD=true
HOST=127.0.0.1
PORT=3099
```

Set `COOKIE_SECURE=true` only when the browser reaches the app over HTTPS.

- For Tailscale on plain `http://100.x.y.z:3099`, leave `COOKIE_SECURE=false`
- For Cloudflared or another HTTPS hostname, set `COOKIE_SECURE=true`

## App details

### What it does

- Link any directory that contains a Compose file (`docker-compose.yml`, `docker-compose.yaml`, `compose.yml`, `compose.yaml`)
- List stacks by directory name
- Expand each service to view runtime, image, version, port, and environment details
- Update everything (`Update All`)
- Update one compose stack (`Update Compose`)
- Update one service in a stack (`Update Service`)
- View systemd service state

Compose editing is available through the Entries tab tools.

### Requirements

- Linux host
- Node.js 20+
- Docker CLI with Compose plugin (`docker compose`)
- systemd for installer and system service view

## Security model

This app can control host Docker Compose stacks and read systemd state.

- Default bind address is `127.0.0.1`
- If you expose it beyond localhost, enable authentication
- Do not publish it directly to the internet without a trusted reverse proxy and authentication

The built-in auth is an app password backed by `.env`.

- Login screen in app
- `HttpOnly` signed session cookie after login
- Optional persistent login with "remember this browser"
- Rate-limited login attempts to reduce brute-force risk

Practical secure setup:

1. Keep app bound to `127.0.0.1` for normal use.
2. Use Tailscale for private remote access, or Cloudflared for intentional HTTPS publishing.
3. Keep app password enabled either way.

## Distribution notes

Quarterdeck is intended to run directly on the host, not primarily inside a container.

- The app shells out to `docker`, `docker compose`, and `systemctl`
- `data/` stores local runtime state and absolute linked paths
- `data/` is intentionally ignored from Git and should not be included in release archives

Create a sanitized release bundle that excludes local runtime state and dependencies:

```bash
bash ./scripts/create-release-bundle.sh
```

Smoke-test a running instance:

```bash
npm run smoke
```

## API overview

**Auth / session**
- `GET /api/session/status`
- `POST /api/session/login` body `{ "password": "…", "remember": true|false }`
- `POST /api/session/logout`
- `GET /api/auth/status`

**Links**
- `GET /api/links`
- `GET /api/links/index`
- `GET /api/links/:id`
- `POST /api/links` body `{ "dirPath": "/abs/path" }`
- `POST /api/links/scan` body `{ "dirPath": "/abs/path" }`
- `POST /api/compose/import` body `{ "sourcePath": "/abs/file.yml" | "", "sourceContent": "yaml text", "sourceName": "compose.yml", "targetDir": "/abs/dir", "mode": "merge|new", "overwrite": false, "linkAfterImport": true }`
- `POST /api/compose/services/:id` body `{ "yamlText": "web:\n  image: nginx", "overwrite": false }`
- `DELETE /api/compose/services/:id/:serviceName`
- `DELETE /api/links/:id`

**Update**
- `POST /api/update/all`
- `POST /api/update/link/:id`
- `POST /api/update/service/:id/:serviceName`

**Compose control**
- `POST /api/control/link/:id/:action`
- `POST /api/control/service/:id/:serviceName/:action`

**Systemd**
- `GET /api/systemd/services`
- `POST /api/systemd/control/:scope/:serviceName/:action`

**Jobs**
- `GET /api/jobs/:id`
- `POST /api/jobs/:id/cancel`

**Docker auth**
- `POST /api/auth/docker/login`
- `POST /api/auth/docker/logout`

**Health**
- `GET /api/health`
