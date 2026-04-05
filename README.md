# Arr Status & Add (`stremio-addarr`)

Lightweight, self-hosted Stremio add-on for **LAN-first Raspberry Pi deployments**.

It shows concise Sonarr/Radarr status tiles on Stremio detail pages and provides a one-click add action that executes server-side and returns immediately to Stremio.

## Why this add-on exists

- Keep normal usage inside Stremio on Android TV v9.
- Avoid multi-step browser workflows.
- Keep Arr credentials server-side only.
- Stay small and reliable for always-on Pi usage.

## UX model (Stremio-first)

Typical tiles:

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
2. Server performs Arr add/search immediately.
3. Server responds with redirect to the same `stremio:///detail/...` context.
4. Next stream fetch reflects updated state (short cache + mutation invalidation).
5. If both Arr services are disabled or both unreachable, no tiles are returned (fail-soft/no-noise mode).

## Routes

- `/manifest.json`
- `/stream/:type/:id.json`
- `/action/movie/:encodedId`
- `/action/series/:encodedId`
- `/healthz`
- `/status.json`
- `/health`
- `/` (tiny operator probe)

No dashboard/wizard UI is provided.

## Raspberry Pi deployment (recommended)

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

### HTTPS for Android TV (optional but recommended)

Use the included `Caddyfile.example` and set `PUBLIC_BASE_URL` to the HTTPS LAN host (for example `https://stremio-addarr.lan`).

## Configuration

Key settings in `.env`:

| Variable | Purpose |
|---|---|
| `HOST`, `PORT` | Local bind address/port for the Node service. |
| `PUBLIC_BASE_URL` | URL Stremio uses to access this add-on (must be reachable from TV). |
| `REQUEST_TIMEOUT_MS` | Per-request Arr timeout. |
| `STATUS_CACHE_TTL_MS` | In-memory TTL for Arr status lists. |
| `SERVICE_HEALTH_CACHE_TTL_MS` | TTL for cached Arr reachability checks. |
| `STREAM_CACHE_MAX_AGE` | `cacheMaxAge` hint in stream responses. |
| `STREAM_STALE_REVALIDATE` | `staleRevalidate` hint in stream responses. |
| `RADARR_*` | Radarr enable/base URL/API key/root/profile/search behavior. |
| `SONARR_*` | Sonarr enable/base URL/API key/root/profile/search behavior. |

### Security guarantees

- Arr API keys stay in server `.env` only.
- Keys are not put in manifest/action URLs or status output.
- URLs shown in diagnostics are redacted.

## Operator diagnostics

- `GET /healthz` → liveness probe
- `GET /status.json` → machine-readable config/reachability summary
- `GET /health` → health summary with service reachability

## Known protocol limitations

- Stremio add-ons cannot force live UI push updates.
- There are no guaranteed native success toasts from add-ons.
- Therefore status updates appear on the next normal stream refresh.

## Troubleshooting

**No tiles appear at all**
- This is expected when both services are disabled or both are unreachable.
- Check `/status.json` reachability and `RADARR_ENABLED` / `SONARR_ENABLED`.

**Tile shows `🛑 Arr Offline`**
- The relevant service is enabled but unreachable.
- Check Arr URL reachability from the Pi and API key validity.

**Action click doesn’t appear to update instantly**
- Re-open stream list to trigger fresh fetch.
- Ensure `STATUS_CACHE_TTL_MS` is short enough for your preference.

**Manifest not installable from TV**
- Verify `PUBLIC_BASE_URL` is reachable from Android TV.
- Prefer HTTPS via Caddy for remote-device installs.

## Local verification

```bash
npm run typecheck
npm test
npm run build
```
