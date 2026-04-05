# Arr Status & Add (`stremio-addarr`)

Lightweight, self-hosted Stremio add-on for Raspberry Pi + Sonarr/Radarr, with an **HTTPS-first deployment model for stock Android TV v9**.

## Core compatibility rule (important)

For stock/non-root Android TV v9, install this add-on through a **publicly trusted HTTPS certificate** on a **real DNS hostname**.

Recommended example:
- `https://stremio-addarr.example.com/manifest.json`

Not recommended for stock Android TV (may fail):
- `http://...`
- `https://192.168.x.x/...`
- `https://hostname.local/...`
- `https://hostname.lan/...`
- self-signed certs / Caddy internal CA certs

Why: Android apps targeting API 24+ typically do not trust user-added CAs unless app-specific opt-in is present.

---

## UX model (Stremio-first)

Primary surface is Stremio `stream` tiles:

- `✅ Radarr • Downloaded`
- `📌 Radarr • Added`
- `🔎 Radarr • Missing`
- `➕ Add to Radarr + Search`
- `✅ Sonarr • Episode Downloaded`
- `🔎 Sonarr • Episode Missing`
- `📌 Sonarr • Series Added`
- `➕ Add to Sonarr + Search`
- `🛑 Arr Offline`

Action flow:
1. Click add tile in Stremio.
2. Server executes add/search in Arr.
3. Server immediately redirects back to the same `stremio:///detail/...` context.
4. Next stream refresh reflects the updated status.

---

## Architecture (recommended production shape)

- Node app: private listener, e.g. `127.0.0.1:7010`
- Caddy: public HTTPS on 80/443
- Caddy reverse-proxies to Node app
- `PUBLIC_BASE_URL` points to Caddy hostname (never the private bind URL)

This keeps Stremio-facing URLs canonical and stable:
- `/manifest.json`
- `/stream/:type/:id.json`
- `/action/...`
- `/healthz`
- `/status.json`

All generated user-facing links come from `PUBLIC_BASE_URL`.

---

## Quick start on Raspberry Pi

```bash
git clone https://github.com/cbkii/stremio-addarr /opt/stremio-addarr
cd /opt/stremio-addarr
npm ci
cp .env.example .env
nano .env
npm run build
sudo cp deploy/stremio-addarr.service.example /etc/systemd/system/stremio-addarr.service
sudo systemctl daemon-reload
sudo systemctl enable --now stremio-addarr
curl http://127.0.0.1:7010/healthz
```

### Caddy setup (recommended default)

1. Set a real DNS name (example: `stremio-addarr.example.com`) to your Caddy host.
2. Copy `Caddyfile.example` to `/etc/caddy/Caddyfile` and edit hostname.
3. Reload Caddy.
4. Set `.env`:
   - `HOST=127.0.0.1`
   - `PORT=7010`
   - `TARGET_CLIENT=android-tv`
   - `PUBLIC_BASE_URL=https://stremio-addarr.example.com`
5. Verify:
   - `curl -I https://stremio-addarr.example.com/manifest.json`
   - `curl https://stremio-addarr.example.com/status.json`

If your Pi is LAN-only, use split-horizon DNS / local DNS override / hairpin NAT, or use DNS challenge for certificates.

---

## Configuration

Key `.env` settings:

| Variable | Purpose |
|---|---|
| `HOST`, `PORT` | Private Node bind address/port (typically `127.0.0.1:7010`). |
| `PUBLIC_BASE_URL` | Public Stremio-facing origin for manifest/action links. |
| `TARGET_CLIENT` | `android-tv` (strict default) or `generic` (advanced mode). |
| `REQUEST_TIMEOUT_MS` | Per-request Arr timeout. |
| `STATUS_CACHE_TTL_MS` | TTL for status-heavy cache entries. |
| `SERVICE_HEALTH_CACHE_TTL_MS` | TTL for Arr reachability checks. |
| `RADARR_*`, `SONARR_*` | Arr integration settings. |

### Strict `PUBLIC_BASE_URL` checks

Validation requires a valid absolute URL and warns loudly when:
- HTTP is used
- hostname is an IP
- hostname is internal-only (`localhost`, `.local`, `.lan`, single-label hostnames)
- path-prefix hosting is configured

In `TARGET_CLIENT=android-tv`, these conditions flag:
- `Android TV compatibility likely broken`
- `Caddy/public certificate recommended`

---

## Diagnostics

- `GET /healthz`: liveness + Android-TV compatibility summary.
- `GET /status.json`: machine-readable diagnostics including:
  - bind host/port
  - `PUBLIC_BASE_URL`
  - HTTPS/IP/internal-hostname/path-prefix flags
  - compatibility assessment for stock Android TV
  - Arr reachability (without exposing API keys)
- `GET /health`: service health summary.

No secrets are exposed in output.

---

## Advanced mode (kept, not recommended)

`TARGET_CLIENT=generic` allows advanced local setups (HTTP, IP URLs, internal names, internal CAs), but these are **not recommended** for stock Android TV because trust may fail in-app.

Use only if you understand the certificate trust trade-offs and your client environment is controlled.

---

## Local verification

```bash
npm run typecheck
npm test
npm run build
```
