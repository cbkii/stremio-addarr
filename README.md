# Arr Status & Add (`stremio-addarr`)

Self-hosted, LAN-first Stremio add-on that shows **Radarr/Sonarr status** and provides one clear **Add + Search** action from Stremio item pages.

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
- Action tiles open a tiny server-side action route and return a TV-readable result page with a **Back to Stremio** link.

## Supported Stremio model

Primary resource: **`stream`** (officially supported).

Routes served:
- `/manifest.json`
- `/stream/:type/:id.json`
- `/health`
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
- `src/services/radarr.ts` – Radarr status/add logic
- `src/services/sonarr.ts` – Sonarr status/add logic
- `src/services/status.ts` – tile orchestration + health aggregation
- `src/lib/http.ts` – JSON HTTP client + timeout
- `src/lib/stremio-ids.ts` – ID parsing and deep links
- `src/ui/landing.ts` – landing/action HTML pages
- `test/*.test.ts` – unit/integration tests
- `.github/workflows/*.yml` – CI and tag-release automation

## Environment variables

Copy `.env.example` to `.env` and set values.

| Variable | Required | Description |
|---|---:|---|
| `HOST` | no | Bind address (`0.0.0.0` default). |
| `PORT` | no | HTTP listen port (`7010`). |
| `PUBLIC_BASE_URL` | yes | Public base URL Stremio will use for install and requests. |
| `LOG_LEVEL` | no | `debug`, `info`, `warn`, `error`. |
| `REQUEST_TIMEOUT_MS` | no | Arr request timeout in ms (>=1000). |
| `STATUS_CACHE_TTL_MS` | no | status cache TTL ms (>=1000). |
| `ACTION_CONFIRM` | no | `true` shows confirm page before side effects. |
| `RADARR_ENABLED` | no | enable Radarr integration. |
| `RADARR_BASE_URL` | when enabled | Radarr URL (http/https). |
| `RADARR_API_KEY` | when enabled | Radarr API key. |
| `RADARR_ROOT_FOLDER_PATH` | when enabled | Add target folder path. |
| `RADARR_QUALITY_PROFILE_ID` | when enabled | Radarr quality profile ID. |
| `RADARR_MINIMUM_AVAILABILITY` | no | e.g. `announced`, `released`. |
| `RADARR_TAGS` | no | comma-separated tags. |
| `RADARR_SEARCH_ON_ADD` | no | trigger search immediately. |
| `SONARR_ENABLED` | no | enable Sonarr integration. |
| `SONARR_BASE_URL` | when enabled | Sonarr URL (http/https). |
| `SONARR_API_KEY` | when enabled | Sonarr API key. |
| `SONARR_ROOT_FOLDER_PATH` | when enabled | Add target folder path. |
| `SONARR_QUALITY_PROFILE_ID` | when enabled | Sonarr quality profile ID. |
| `SONARR_LANGUAGE_PROFILE_ID` | when enabled | Sonarr language profile ID. |
| `SONARR_SERIES_MONITOR` | no | monitor mode (`all`, etc). |
| `SONARR_SEARCH_ON_ADD` | no | trigger missing episode search. |
| `SONARR_TAGS` | no | comma-separated tags. |
| `TMDB_API_KEY` | optional | reserved for fallback extensions. |

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

Check routes:
- `http://127.0.0.1:7010/`
- `http://127.0.0.1:7010/health`
- `http://127.0.0.1:7010/manifest.json`

## Raspberry Pi / home-server production

### Option A: systemd (recommended)

```bash
npm ci
npm run build
sudo cp deploy/stremio-addarr.service.example /etc/systemd/system/stremio-addarr.service
sudo systemctl daemon-reload
sudo systemctl enable --now stremio-addarr
sudo systemctl status stremio-addarr
```

### Option B: Docker

```bash
docker compose -f docker-compose.example.yml up -d --build
```

## HTTPS / reverse proxy: when it is needed

A reverse proxy (Caddy, Nginx, Traefik, etc.) is **not always required**:

- If Stremio and add-on run on the **same device** using `127.0.0.1`, direct HTTP may be enough.
- If Stremio client (TV) is on a **different device**, use HTTPS on a LAN hostname reachable by the TV.

`Caddyfile.example` is provided as a lightweight optional path because Caddy is simple for home LAN TLS (`tls internal`) and reverse proxying to `127.0.0.1:7010`.

## Install in Stremio

1. Open your add-on landing page (`/`) and copy `manifest.json` URL.
2. Install using Stremio add-on install flow (or `stremio://` URL shown on landing page).
3. Open a movie/episode detail page and check Arr status tile.

## Testing & quality commands

```bash
npm run typecheck
npm test
npm run build
```

## CI and release automation

- CI workflow: `.github/workflows/ci.yml` (push to `main`, PRs)
- Release workflow: `.github/workflows/release.yml` on tags `v*.*.*`
- Release artifacts generated by `npm run package:release`:
  - `dist/stremio-addarr-source.tar.gz`
  - `dist/stremio-addarr-bundle.tar.gz`
  - `dist/checksums.txt`

### Tag and publish release

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Upgrade steps

1. Pull latest code.
2. `npm ci`
3. `npm run build`
4. Restart service/container.
5. Verify `/health` and `/manifest.json`.

## Troubleshooting

- **Cannot install manifest**
  - Verify `PUBLIC_BASE_URL` is reachable from TV.
  - Prefer HTTPS LAN URL behind Caddy.
- **Arr unreachable**
  - Confirm network path and API keys.
  - Check `/health` service status details.
- **Item not resolving**
  - Confirm IMDb ID exists in Stremio item context.
  - Check Sonarr/Radarr lookup support for that title.
- **Action tile opens but add fails**
  - Verify root/profile IDs and Arr permissions.
  - Check server logs for HTTP status detail.
- **Back-to-Stremio flow behaves differently on TV browser**
  - Use result page fallback link and remote back action.
