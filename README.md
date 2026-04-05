# Arr Status & Add (`stremio-addarr`)

Self-hosted, LAN-first Stremio add-on that shows **Radarr/Sonarr status** and provides one clear **Add + Search** action from Stremio item pages.

**Primary deployment target: Raspberry Pi + systemd + Caddy on home LAN.**  
**Primary client: Stremio on Android TV v9 (D-pad remote).**  
**All end-user UX happens inside Stremio — no browser pages for normal use.**

## Design goals

- **LAN-only / Raspberry Pi first.** Minimal CPU, RAM, and request overhead.
- **UX inside Stremio.** Status and action are tile labels/descriptions; clicking "Add" triggers the action directly — no confirmation browser page needed.
- **No web UI.** Root `/`, `/healthz`, `/health`, `/status.json` are operator-only endpoints for debugging. End users never need to open a browser.
- **No extra dependencies.** Keep the runtime lean — native `fetch`, Express, `stremio-addon-sdk`. Nothing else.

## What it does

- On **movie** pages (`tt...`):
  - `Radarr • Downloaded`
  - `Radarr • Added`
  - `Radarr • Missing`
  - `Radarr • Not Added` + `Add to Radarr + Search`
- On **episode/series** pages (`tt...` or `tt...:S:E`):
  - `Sonarr • Episode Downloaded`
  - `Sonarr • Episode Missing`
  - `Sonarr • Series Added`
  - `Sonarr • Series Not Added` + `Add to Sonarr + Search`
- Clicking `Add to Radarr + Search` or `Add to Sonarr + Search` opens a server-side action endpoint that **immediately performs the add** (no confirmation step by default) and returns a minimal plain-text result page with a **← Back to Stremio** link.
- Set `ACTION_CONFIRM=true` to show a minimal confirm form before adding (useful on shared setups).

## Deployment priority

1. **Raspberry Pi + systemd** (primary — recommended)
2. **Raspberry Pi + Docker**
3. **Local development**
4. Any public hosting (secondary — not the primary use case)

## Quick start (Raspberry Pi)

```bash
# 1. Clone and install
git clone https://github.com/cbkii/stremio-addarr /opt/stremio-addarr
cd /opt/stremio-addarr
npm ci

# 2. Configure
cp .env.example .env
nano .env   # set RADARR_BASE_URL, RADARR_API_KEY, SONARR_BASE_URL, SONARR_API_KEY

# 3. Build
npm run build

# 4. Install and start systemd service
sudo cp deploy/stremio-addarr.service.example /etc/systemd/system/stremio-addarr.service
sudo systemctl daemon-reload
sudo systemctl enable --now stremio-addarr

# 5. Verify
curl http://127.0.0.1:7010/healthz
```

Then follow the **Caddy reverse proxy** section to enable HTTPS for Android TV access.

## Supported Stremio model

Primary resource: **`stream`** (officially supported).

Routes served:
- `/manifest.json`
- `/stream/:type/:id.json`
- `/healthz` — liveness probe
- `/health` — legacy health + service status
- `/status.json` — structured diagnostics (no secrets)
- `/action/movie/:encodedId`
- `/action/series/:encodedId`
- `/`

This add-on does **not** inject undocumented native UI buttons.

## Architecture summary

- TypeScript, Node.js 20+
- Express host + `stremio-addon-sdk`
- Native `fetch` with explicit timeout
- Short TTL in-memory cache
- Server-side `.env` configuration for secrets
- LAN-first deployment with reverse proxy HTTPS (Caddy example included)

## Repository layout

- `src/index.ts` – Express app, routes, CORS, action flow
- `src/addon.ts` – Stremio manifest + stream handler
- `src/config.ts` – env-driven config + validation
- `src/services/radarr.ts` – Radarr status/add logic
- `src/services/sonarr.ts` – Sonarr status/add logic
- `src/services/status.ts` – tile orchestration + health aggregation
- `src/lib/http.ts` – JSON HTTP client + timeout
- `src/lib/stremio-ids.ts` – ID parsing and deep links
- `src/ui/landing.ts` – landing/action HTML pages
- `test/*.test.ts` – unit/integration tests

## Environment variables

Copy `.env.example` to `.env` and set values.

| Variable | Required | Description |
|---|---:|---|
| `HOST` | no | Bind address (`0.0.0.0` default). |
| `PORT` | no | HTTP listen port (`7010`). |
| `PUBLIC_BASE_URL` | yes | Public base URL Stremio will use for install and requests. |
| `LOG_LEVEL` | no | `debug`, `info`, `warn`, `error`. |
| `REQUEST_TIMEOUT_MS` | no | Arr request timeout in ms (>=1000). |
| `STATUS_CACHE_TTL_MS` | no | Status cache TTL ms (>=1000). |
| `ACTION_CONFIRM` | no | `true` shows confirm page before side effects. |
| `RADARR_ENABLED` | no | Enable Radarr integration. |
| `RADARR_BASE_URL` | when enabled | Radarr URL (http/https). Same Pi: `http://127.0.0.1:7878`. |
| `RADARR_API_KEY` | when enabled | Radarr API key. |
| `RADARR_ROOT_FOLDER_PATH` | when enabled | Add target folder path. |
| `RADARR_QUALITY_PROFILE_ID` | when enabled | Radarr quality profile ID. |
| `RADARR_MINIMUM_AVAILABILITY` | no | e.g. `announced`, `released`. |
| `RADARR_TAGS` | no | Comma-separated tags. |
| `RADARR_SEARCH_ON_ADD` | no | Trigger search immediately. |
| `SONARR_ENABLED` | no | Enable Sonarr integration. |
| `SONARR_BASE_URL` | when enabled | Sonarr URL (http/https). Same Pi: `http://127.0.0.1:8989`. |
| `SONARR_API_KEY` | when enabled | Sonarr API key. |
| `SONARR_ROOT_FOLDER_PATH` | when enabled | Add target folder path. |
| `SONARR_QUALITY_PROFILE_ID` | when enabled | Sonarr quality profile ID. |
| `SONARR_LANGUAGE_PROFILE_ID` | when enabled | Sonarr language profile ID. |
| `SONARR_SERIES_MONITOR` | no | Monitor mode (`all`, `future`, `missing`, `unaired`, `none`). |
| `SONARR_SEARCH_ON_ADD` | no | Trigger missing episode search. |
| `SONARR_TAGS` | no | Comma-separated tags. |
| `TMDB_API_KEY` | optional | Reserved for fallback extensions. |

## Caddy reverse proxy

HTTPS is **strongly recommended** when Stremio (on Android TV) runs on a different device than the add-on. Caddy provides automatic self-signed certificates for LAN hostnames with zero config.

### Setup steps

```bash
# 1. Install Caddy (on the Pi)
#    https://caddyserver.com/docs/install

# 2. Copy the example Caddyfile
sudo cp Caddyfile.example /etc/caddy/Caddyfile

# 3. Add DNS resolution on the TV (or your LAN router/Pi-hole)
#    On Android TV: Settings > Network > Hosts (or use Pi-hole)
#    Or add to the TV's /etc/hosts: <Pi LAN IP> stremio-addarr.lan

# 4. Reload Caddy
sudo systemctl reload caddy

# 5. Set in .env:
#    PUBLIC_BASE_URL=https://stremio-addarr.lan
```

Caddy handles TLS termination and passes requests to `127.0.0.1:7010`. The Express app handles CORS for Stremio routes internally.

## Install in Stremio

1. Get the manifest URL: `http://<pi-ip>:7010/manifest.json` (or `https://stremio-addarr.lan/manifest.json` with Caddy).
2. In Stremio, go to **Add-ons → Community Add-ons → Install from URL** and paste the manifest URL.  
   Or navigate to `stremio://<pi-ip>:7010/manifest.json` directly.
3. On Android TV: open any movie or episode detail page — the Arr status tile appears in the streams list.

The root `http://<pi-ip>:7010/` returns a small JSON summary for operator use only.

## Android TV notes

- The add-on uses `externalUrl` in the `stream` resource — clicking an action tile opens the device browser briefly.
- When `ACTION_CONFIRM=false` (default), clicking `Add to Radarr + Search` **immediately triggers the add**. The browser shows a plain result page with a **← Back to Stremio** link.
- Press the TV remote **back button** or tap **← Back to Stremio** to return to the item page.
- If HTTPS is not configured, Stremio on Android TV may refuse to install the manifest from a remote IP.

## Diagnostics (operator-only)

These endpoints are for the operator to verify the add-on is working. End users don't need them.

| Endpoint | Description |
|---|---|
| `/healthz` | Liveness probe: `{"ok":true}` |
| `/` | Tiny JSON summary: name, version, manifest URL |
| `/health` | Service health + version |
| `/status.json` | Full diagnostics: config, reachability, issues (no secrets) |

`/status.json` includes:
- `publicBaseUrlIsHttps` — whether HTTPS is configured
- `radarr.reachable` / `sonarr.reachable` — live ping result
- `configIssues` — human-readable warning strings

## Local development

```bash
npm install
cp .env.example .env
# Edit .env with your Radarr/Sonarr credentials
npm run dev
```

Check routes:
- `http://127.0.0.1:7010/`
- `http://127.0.0.1:7010/healthz`
- `http://127.0.0.1:7010/health`
- `http://127.0.0.1:7010/status.json`
- `http://127.0.0.1:7010/manifest.json`

## Testing

```bash
npm run typecheck
npm test
npm run build
```

## CI and release

- CI workflow runs typecheck, tests, and build on every push/PR.
- Release workflow triggers on `v*.*.*` tags.

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Troubleshooting

**Cannot install manifest / Stremio rejects the manifest URL**
- Verify `PUBLIC_BASE_URL` is reachable from your TV's network.
- If Stremio is on Android TV and the add-on is on a Pi, you need HTTPS. Set up Caddy.
- Check `configIssues` in `/status.json` for specific warnings.

**CORS error in browser / manifest fetch fails**
- CORS is handled by Express for `/manifest.json` and `/stream/...` routes.
- Do not add CORS headers in Caddy — it passes them through from Express.

**Arr service unreachable**
- Confirm `RADARR_BASE_URL` / `SONARR_BASE_URL` is reachable from the Pi.
- If Arr is on another LAN host: use its fixed IP, e.g. `http://192.168.1.50:7878`.
- Check `/status.json` for `radarr.detail` / `sonarr.detail` error classification (`auth_error`, `timeout`, `unreachable`, etc.).

**Action works but item not added in Radarr/Sonarr**
- Verify `RADARR_ROOT_FOLDER_PATH`, `RADARR_QUALITY_PROFILE_ID`, etc. match your Radarr/Sonarr setup.
- Check Radarr/Sonarr logs for POST errors.
- For Sonarr: ensure the series has a TVDB ID; for Radarr: ensure the movie has a TMDB ID.

**TV page navigation quirks**
- If the action page does not respond to remote clicks, try the TV's browser back button.
- The confirm page submits a POST form — select the button with the D-pad and press OK/Enter.

**HTTPS certificate warning on Android TV**
- Caddy's `tls internal` generates a self-signed certificate. Android TV may warn on first install.
- Accept the certificate once, or use Let's Encrypt with a real domain if you have one.
- For LAN-only use, self-signed is sufficient.
