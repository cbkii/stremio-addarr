# Arr Status & Add (`stremio-addarr`)

Self-hosted Stremio add-on that shows Sonarr/Radarr status tiles and provides one-click add/search actions.

It also exposes two browseable personal catalogs in Stremio Discover/Board:
- **Recent on Radarr** (movies)
- **Recent on Sonarr** (series)

These catalogue rows combine **active downloads and recent imports** from your local Arr services.
Cards intentionally use minimal metadata (IMDb id, name, description, releaseInfo) and rely on Stremio/Cinemeta for artwork.

> Designed and tested on LAN-connected Raspberry Pi 5 [Debian Trixie] and Android 9 TV

This README is the **canonical install and upgrade guide**.

---

## 1) What you will set up

- `stremio-addarr` runs locally on your host at `127.0.0.1:7010`.
- Caddy serves a public HTTPS URL (required for non-root Android TV Stremio).
- Stremio installs the add-on from:

```text
https://YOUR_HOSTNAME/manifest.json
```

The hostname in all places must match exactly:
- DuckDNS subdomain
- Caddy site address
- `.env` → `PUBLIC_BASE_URL`
- Final manifest URL pasted into Stremio

For hosting/TLS/reverse proxy, follow **README_HOST.md**: [README_HOST.md](README_HOST.md).

---

## 2) Prerequisites

Run these checks first:

```bash
node --version
npm --version
```

- Node must be **20+**.
- Sonarr and/or Radarr must be reachable from this host.
- You need a service account (user and group) that exist on your host.
- `quick.sh` requires: `gh`, `sudo`, `systemctl`, `curl`, `tar`, `sha256sum`, `file`, `diff`, and `nano`.

Service account behavior with `quick.sh`:
- By default, `quick.sh` uses your current shell account:
  - user: `$(whoami)`
  - group: `$(id -gn)`
- If you run `stremio-addarr` as a dedicated service account, pass it explicitly:

```bash
bash quick.sh install --svc-user YOUR_SVC_USER --svc-group YOUR_SVC_GROUP
```

The same override works for upgrades:

```bash
bash quick.sh upgrade --svc-user YOUR_SVC_USER --svc-group YOUR_SVC_GROUP
```

---

## 3) Table of contents / choose your path

- **[4) Quick install](#4-quick-install-recommended)**
- **[5) Quick upgrade](#5-quick-upgrade-recommended)**
- **[6) Runtime checks](#6-runtime-checks)**
- **[7) Logs and diagnostics](#7-logs-and-diagnostics)**
- **[8) Android TV + Stremio troubleshooting](#8-android-tv--stremio-troubleshooting)**
- **[9) Troubleshooting playbook](#9-troubleshooting-playbook)**
- **[10) Release and hosting docs](#10-release-and-hosting-docs)**
- **Docker (optional alternative)**: `Dockerfile` and `docker-compose.example.yml` are provided for containerized deployment; the systemd path in this README remains the canonical/default setup.

---

## 4) Quick install (recommended)

Use the guided quick script. It performs the release download, checksum verification, extraction, dependency install, `.env` setup gate, systemd setup gate, and verification checks with clear `OK|WARN|FAIL` output.

```bash
# curl -fsSL https://raw.githubusercontent.com/${REPO}/${TAG}/quick.sh -o quick.sh
gh release download --repo cbkii/stremio-addarr --pattern quick.sh --output quick.sh --clobber
chmod +x quick.sh
bash quick.sh install
```

Pin to a specific release when needed (`--tag` is optional; default is latest, and both `1.2.3` and `v1.2.3` are accepted):

```bash
gh release download vX.Y.Z --repo cbkii/stremio-addarr --pattern quick.sh --output quick.sh --clobber
bash quick.sh install --repo cbkii/stremio-addarr --tag vX.Y.Z
```

Optional account override:

```bash
bash quick.sh install --svc-user YOUR_SVC_USER --svc-group YOUR_SVC_GROUP
```

During the guided `.env` review gate, ensure required values are set:

```dotenv
HOST=127.0.0.1
PORT=7010
PUBLIC_BASE_URL=https://YOUR_HOSTNAME
TARGET_CLIENT=android-tv
GRACEFUL_SHUTDOWN_TIMEOUT_MS=10000
FORCED_SHUTDOWN_EXIT_CODE=0

RADARR_ENABLED=true
RADARR_BASE_URL=http://127.0.0.1:7878
RADARR_API_KEY=replace-with-radarr-api-key
RADARR_ROOT_FOLDER_PATH=/media/movies
RADARR_QUALITY_PROFILE_ID=1

SONARR_ENABLED=true
SONARR_BASE_URL=http://127.0.0.1:8989
SONARR_API_KEY=replace-with-sonarr-api-key
SONARR_ROOT_FOLDER_PATH=/media/tv
SONARR_QUALITY_PROFILE_ID=1
SONARR_LANGUAGE_PROFILE_ID=1
SONARR_SERIES_MONITOR=all

CATALOG_PAGE_SIZE=35
RADARR_CATALOG_WATCHED_KEEP_COUNT=1
CATALOG_CACHE_TTL_MS=5000
CATALOG_CACHE_MAX_AGE_SEC=15
CATALOG_STALE_REVALIDATE_SEC=60
CATALOG_STALE_ERROR_SEC=120
```

Notes:
- `MANIFEST_LOGO_URL` defaults to `https://img.icons8.com/?size=100&id=43669&format=png&color=000000`. With this default, Stremio clients will fetch the logo from `img.icons8.com`, which can leak client IPs to that third party and makes logo availability depend on that external service. For privacy-sensitive deployments, set `MANIFEST_LOGO_URL=none` to hide the logo, or set `MANIFEST_LOGO_URL` to a self-hosted HTTPS logo URL (query parameters are allowed, e.g. `https://example.com/logo.png?v=2`).
- `SONARR_SERIES_MONITOR` maps directly to Sonarr's `addOptions.monitor` field and accepts: `all`, `future`, `missing`, `existing`, `firstSeason`, `lastSeason`, `latestSeason`, `pilot`, `recent`, `monitorSpecials`, `unmonitorSpecials`, `none`, `skip`, `ep`, `epfuture`, or `epseason`.
- `SONARR_SERIES_MONITOR` is parsed case-insensitively (`ALL`, `All`, `none` all work).
- Episode-scoped custom values in `SONARR_SERIES_MONITOR`:
  - `ep`: after add/search, monitor only the selected episode and set Sonarr `monitorNewItems=none`.
  - `epfuture`: after add/search, monitor selected episode and all later episodes, then set Sonarr `monitorNewItems=all` (future episodes).
  - `epseason`: after add/search, monitor selected episode through season end, then set Sonarr `monitorNewItems=none`.
- `SONARR_MONITOR_NEW_ITEMS` controls `monitorNewItems` updates:
  - `auto` (default): `epfuture=>all`, `ep/epseason=>none`, non-scoped default add uses `all`.
  - `all` / `none`: force one value regardless of scoped mode.
- `EP_COUNT`/`EP_COUNT_MOD` tune `ep` auto-upgrade behavior:
  - `EP_COUNT_PAST` controls how many prior normal episodes are examined (default `8`).
  - If `EP_COUNT > 1`, the addon checks up to `EP_COUNT_PAST` prior episodes before the selected pivot.
  - If downloaded count in that window is `>= EP_COUNT`, `ep` is upgraded to `EP_COUNT_MOD` (`epfuture` or `epseason`).
  - `EP_COUNT <= 1` disables the auto-upgrade.
  - Because Stremio add-on requests are anonymous, this heuristic currently uses Sonarr-known downloaded episodes (not user watch-history from Stremio/Trakt).
- `SONARR_EPISODE_READY_TIMEOUT_MS` and `SONARR_EPISODE_READY_POLL_MS` tune how long the addon waits for Sonarr episode metadata to become ready after series add.
- `RADARR_TAGS` and `SONARR_TAGS` accept comma-separated integer tag IDs (e.g. `1,3`). Find IDs via Arr → Settings → Tags.
- Catalog cache variables are optional tuning knobs; defaults are production-safe for Pi/LAN use.
- `RADARR_CATALOG_WATCHED_KEEP_COUNT` (default `1`) keeps a small number of watched movies visible in filtered Radarr catalogs; set `0` to hide watched movies entirely or raise it to keep more.
- `FORCED_SHUTDOWN_EXIT_CODE=0` keeps orchestrators from flagging timeout-forced stop as a failed exit.

Optional tuning:
- `CATALOG_PAGE_SIZE` (default `35`, max effective `50`): how many cards each catalog page returns.
- `RADARR_CATALOG_WATCHED_KEEP_COUNT` (default `1`): how many watched movies remain visible in filtered Radarr catalog views.
- `CATALOG_CACHE_TTL_MS` (default `5000`): short in-memory cache for merged Arr queue+history results and progressive Radarr watched-filter pagination state.
- `CATALOG_CACHE_MAX_AGE_SEC` (default `15`): fresh cache hint sent to Stremio for catalog responses.
- `CATALOG_STALE_REVALIDATE_SEC` (default `60`): stale-while-revalidate hint sent to Stremio.
- `CATALOG_STALE_ERROR_SEC` (default `120`): stale-if-error hint sent to Stremio.

Catalog caching behavior:
- Radarr and Sonarr base catalog rows (queue+import merge) are cached in-memory for `CATALOG_CACHE_TTL_MS`.
- Radarr default/unwatched filtered pagination is cached progressively within the same TTL window, so adjacent `skip` pages avoid re-checking already-scanned items.
- `filter=recent` remains unfiltered and bypasses watched filtering.
- `RADARR_CATALOG_WATCHED_KEEP_COUNT` is applied globally across the sorted filtered catalog (not per-page), including when cached pagination is used.
- Add/search/monitor actions are **not** cached; status/catalog caches are invalidated after Arr mutations.

The script also includes a guided systemd unit review gate and starts the service.

### Step 6 — Configure hosting/TLS (required)

Follow **README_HOST.md** now: [README_HOST.md](README_HOST.md).

When finished, you must have:
- Caddy serving `https://YOUR_HOSTNAME`
- `PUBLIC_BASE_URL=https://YOUR_HOSTNAME`

### Step 7 — End-to-end verification (required before Stremio install)

`quick.sh install` already runs local and public manifest checks and prints the final install URL.
Exact URL to paste into Stremio:

```text
$PUBLIC_BASE_URL/manifest.json
```

### Step 8 — Install in Stremio

On Stremio (Android TV):
1. Open **Add-ons**.
2. Open **Community Add-ons** (or search).
3. Paste the manifest URL from Step 7:
   - `https://YOUR_HOSTNAME/manifest.json`
4. Click **Install**.

---

## 5) Quick upgrade (recommended)

Use the guided quick script. It keeps your existing `.env` and service wiring, reapplies ownership and dependencies, opens explicit review gates for `.env` and systemd unit changes, and runs verification checks.

```bash
gh release download --repo cbkii/stremio-addarr --pattern quick.sh --output quick.sh --clobber
chmod +x quick.sh
bash quick.sh upgrade
```

Pin to a specific release when needed (`--tag` is optional; default is latest, and both `1.2.3` and `v1.2.3` are accepted):

```bash
gh release download vX.Y.Z --repo cbkii/stremio-addarr --pattern quick.sh --output quick.sh --clobber
bash quick.sh upgrade --repo cbkii/stremio-addarr --tag vX.Y.Z
```

Important for systemd operators:
- If `/opt/stremio-addarr/.env` changes, you must restart `stremio-addarr` (systemd does not hot-reload `EnvironmentFile`).
- To inspect live runtime environment on Linux: `sudo tr '\0' '\n' </proc/$(systemctl show -p MainPID --value stremio-addarr)/environ | sort`.
- If Stremio still shows stale add-on metadata after deploy, remove/reinstall the add-on or force manifest refresh from the add-on URL.

If your hostname/TLS setup changed, re-run the hosting guide: [README_HOST.md](README_HOST.md).

---

## 6) Runtime checks

```bash
sudo journalctl -u stremio-addarr -n 50 --no-pager
curl -fsS http://127.0.0.1:7010/healthz
source /opt/stremio-addarr/.env
curl -fsS "https://$PUBLIC_BASE_URL/status.json"
```

---

## 7) Logs and diagnostics

### Log format

All logs are structured JSON, emitted to **stdout** (info/debug/warn) and **stderr** (error).
Each line is a single JSON object with at minimum: `time`, `level`, `message`.

```json
{"time":"2024-11-01T14:32:01.123Z","level":"info","message":"request","reqId":"a1b2c3d4-...","method":"GET","path":"/stream/movie/tt1234567","status":200,"durationMs":42}
{"time":"2024-11-01T14:32:01.081Z","level":"info","message":"radarr add success","imdbId":"tt1234567","title":"Example Movie","searchOnAdd":true}
{"time":"2024-11-01T14:32:00.950Z","level":"debug","message":"arr response","service":"radarr","method":"GET","path":"/api/v3/movie","status":200,"durationMs":18}
```

Set `LOG_LEVEL` in `.env`:

| Value   | What you get                                                   |
|---------|----------------------------------------------------------------|
| `error` | Fatal/unexpected failures only                                 |
| `warn`  | Arr API errors, timeouts, auth failures, add/search warnings   |
| `info`  | Every HTTP request + Arr add/search operations (recommended)   |
| `debug` | All of the above + individual outgoing Arr API call timings    |
| `none`  | Silence all log output                                         |

For production Raspberry Pi use `LOG_LEVEL=info`. Switch to `debug` only while investigating a problem.

### Collecting logs — systemd (Raspberry Pi / Linux service)

```bash
# Last 100 lines
sudo journalctl -u stremio-addarr -n 100 --no-pager

# Follow live
sudo journalctl -u stremio-addarr -f

# Tail and pretty-print with jq
sudo journalctl -u stremio-addarr -n 200 --no-pager -o cat | jq .

# Filter for problems only: warn captures Arr API/timeout/auth issues; error captures unexpected failures
sudo journalctl -u stremio-addarr -n 500 --no-pager -o cat | jq 'select(.level == "error" or .level == "warn")'

# Logs in a time window (e.g., last 10 minutes)
sudo journalctl -u stremio-addarr --since "10 minutes ago" --no-pager -o cat | jq .
```

Expected startup output:

```json
{"time":"...","level":"warn","message":"Config issue","issue":"PUBLIC_BASE_URL uses HTTP"}
{"time":"...","level":"info","message":"Server started","host":"127.0.0.1","port":7010,"manifest":"https://example.duckdns.org/manifest.json"}
```

### Collecting logs — Docker (optional alternative deployment)

Use this section only if you deployed with Docker.

```bash
# Last 200 lines
docker logs stremio-addarr --tail 200

# Follow live
docker logs stremio-addarr -f

# Filter errors with jq
docker logs stremio-addarr --tail 500 2>&1 | jq 'select(.level == "error" or .level == "warn")'

# Logs in a time window
docker logs stremio-addarr --since 10m 2>&1 | jq .
```

### Collecting logs — local dev (`npm run dev`)

Logs appear directly in the terminal. Pipe to `jq` for easier reading:

```bash
npm run dev 2>&1 | jq .
```

### Correlating a Stremio stream request end-to-end

Each HTTP request gets a unique `reqId`. Find the Stremio stream request and trace it:

```bash
# Find the stream request for a specific title/id
sudo journalctl -u stremio-addarr -n 500 --no-pager -o cat \
  | jq 'select(.path and (.path | startswith("/stream/")))'

# Example output:
# {"time":"...","level":"info","message":"request","reqId":"abc-123","method":"GET","path":"/stream/movie/tt1234567","status":200,"durationMs":55}
# {"time":"...","level":"info","message":"stream handler complete","type":"movie","id":"tt1234567","tileCount":1,"durationMs":48}
```

---

## 8) Android TV + Stremio troubleshooting

### Symptoms to capture from Stremio on Android TV

When the add-on tile does not appear or shows an error in Stremio on Android TV:

1. **Note the exact time** of the failed playback attempt (or when tiles didn't load).
2. **Note the title** you were browsing (movie name or series/episode).
3. Look at the tile name shown — for example `🛑 Down` means Arr was unreachable at that moment; `➕ Add Radarr` means the item was not found in Radarr.

Stremio on Android TV does **not** expose an in-app log. There is no practical way to extract Stremio client logs from a stock Android TV without ADB. The most actionable path is to correlate the **time window** from the Android TV with addon-side logs.

### Collecting addon logs for an Android TV playback attempt

```bash
# Get addon logs for the last 5 minutes after a failed playback
sudo journalctl -u stremio-addarr --since "5 minutes ago" --no-pager -o cat | jq .

# Filter for completed stream handler calls (info level — visible at LOG_LEVEL=info or lower)
sudo journalctl -u stremio-addarr --since "5 minutes ago" --no-pager -o cat \
  | jq 'select(.message == "stream handler complete")'

# Note: "stream handler start" is logged at debug level and only visible with LOG_LEVEL=debug
```

### ADB log collection (advanced, requires USB debug mode on Android TV)

If you have ADB access to the Android TV device:

```bash
adb connect <android-tv-ip>:5555
adb logcat -d -s Stremio | tail -100
```

This is typically not available on stock Android TV without developer options enabled. If ADB is not available, rely on the addon-side logs correlated by time window.

### Matching Android TV events to addon logs

1. Note the approximate time the tile appeared/failed on Android TV.
2. Pull addon logs for a ±2 minute window around that time:
   ```bash
   sudo journalctl -u stremio-addarr \
     --since "2024-11-01 14:30:00" \
     --until "2024-11-01 14:35:00" \
     --no-pager -o cat | jq .
   ```
3. Look for `"message":"request"` lines with `"path"` starting with `/stream/` — the `reqId` field uniquely identifies each stream lookup.
4. Look for `radarr` or `sonarr` lines with the same `imdbId` to trace what the service returned.

---

## 9) Troubleshooting playbook

### Stremio shows `🛑 Down` tile

**Cause:** Addon could not reach Radarr or Sonarr.

```bash
# 1. Check connectivity from Pi to Arr
curl -fsS http://127.0.0.1:7878/api/v3/system/status \
  -H "X-Api-Key: YOUR_RADARR_KEY" | jq .version

# 2. Check addon health
curl -fsS http://127.0.0.1:7010/health | jq .

# 3. Check logs for timeout or auth errors
sudo journalctl -u stremio-addarr -n 100 --no-pager -o cat \
  | jq 'select(.level == "warn" or .level == "error")'
```

Common causes and fixes:

| Log message / `errorCategory`   | Likely cause                                        | Fix                                                |
|----------------------------------|-----------------------------------------------------|----------------------------------------------------|
| `timeout`                        | Radarr/Sonarr took too long to respond              | Increase `REQUEST_TIMEOUT_MS`; check Arr load      |
| `auth_error`                     | Wrong API key                                       | Verify `RADARR_API_KEY` / `SONARR_API_KEY` in `.env` |
| `unreachable`                    | Network/firewall blocked or wrong base URL          | Check `RADARR_BASE_URL` / `SONARR_BASE_URL`        |
| `not_found`                      | Wrong base URL path                                 | Remove trailing path segments from base URL        |
| `rate_limited`                   | Too many requests to Arr                            | Increase `STATUS_CACHE_TTL_MS`                     |
| `server_error`                   | Arr returned 5xx                                    | Check Arr service health/logs                      |

---

### Android TV shows no streams at all

**Cause:** Usually a TLS/HTTPS issue — stock Android TV Stremio rejects non-HTTPS or self-signed certs.

```bash
# Check PUBLIC_BASE_URL is HTTPS and reachable from outside
curl -fsI https://YOUR_HOSTNAME/manifest.json

# Check addon status page
curl -fsS https://YOUR_HOSTNAME/status.json | jq '{likelyAndroidTvCompatible, configIssues}'
```

- If `likelyAndroidTvCompatible` is `false`, follow [README_HOST.md](README_HOST.md) to set up Caddy + public certificate.
- If the curl fails from outside, check Caddy is running and DuckDNS is pointing to your IP.

---

### Add action does nothing (tile shows but tapping does nothing)

**Cause:** The `/action/...` route returned an error or the tile URL is unreachable.

```bash
# Check action route logs
sudo journalctl -u stremio-addarr -n 100 --no-pager -o cat \
  | jq 'select(.message == "Action completed" or .message == "Action execution failed")'
```

The route returns a tiny HLS response immediately and enqueues Arr add/search work for async background processing on the Pi host. Validate both:
- HTTP request log line for `/action/...` with `status: 200`
- follow-up `"Action completed"` or `"Action rejected by Arr service"` entry in logs

---

### High latency / slow tiles

**Cause:** Arr API is slow, or cache TTL is very short.

```bash
# Enable debug logging temporarily
# In .env: LOG_LEVEL=debug
sudo systemctl restart stremio-addarr

# Then check arr response timings
sudo journalctl -u stremio-addarr -n 200 --no-pager -o cat \
  | jq 'select(.message == "arr response") | {service, path, durationMs}'
```

Tune `STATUS_CACHE_TTL_MS` (default 30000 ms) to reduce repeated Arr calls for the same title.

---

### Config issues at startup

```bash
# Check for config warnings at startup
sudo journalctl -u stremio-addarr --since boot --no-pager -o cat \
  | jq 'select(.message == "Config issue")'
```

Common startup warnings and fixes:

| Issue message                              | Fix                                                                     |
|--------------------------------------------|-------------------------------------------------------------------------|
| `PUBLIC_BASE_URL uses HTTP`                | Set `PUBLIC_BASE_URL=https://...` and configure Caddy                   |
| `PUBLIC_BASE_URL uses an IP address`       | Use a real DNS hostname (DuckDNS, etc.)                                 |
| `Android TV compatibility likely broken`   | See [README_HOST.md](README_HOST.md)                                    |
| `Neither Radarr nor Sonarr is enabled`     | Set `RADARR_ENABLED=true` and/or `SONARR_ENABLED=true`                  |

### File streaming returns 403 "path outside allowed root"

This route uses canonical path validation (`realpath` + relative path check), so symlink/bind-mount paths are resolved before comparison.

Checklist:
1. Ensure `RADARR_ROOT_FOLDER_PATH` / `SONARR_ROOT_FOLDER_PATH` points to the same mounted path namespace used by Arr.
2. Restart `stremio-addarr` after changing `.env` (systemd `EnvironmentFile` values stay stale until restart).
3. Confirm live root path from startup log (`"Effective runtime config"`).
4. Compare startup root path with Arr file API output (`/api/v3/moviefile/:id` or `/api/v3/episodefile/:id`).

---

## 10) Trakt watched sync (optional)

This add-on cannot read native Stremio account sessions directly inside stream handlers, so watched sync is implemented as **addon-managed Trakt OAuth**.

### Fast path (recommended): guided OAuth via `quick.sh`

Run install or upgrade as normal, and when prompted:
- choose **yes** for "Configure Trakt watched-sync OAuth in this quick run?"
- open the printed Trakt authorize URL
- approve access and paste the returned authorization code

`quick.sh` then exchanges the code for tokens and writes:
- `TRAKT_CLIENT_ID`
- `TRAKT_CLIENT_SECRET`
- `TRAKT_REFRESH_TOKEN`
- `TRAKT_SYNC_ENABLED=true`
- `TRAKT_SYNC_MINS=360` (if missing)

### Manual path (advanced / no quick script)

1. Create a Trakt API app and obtain:
   - `TRAKT_CLIENT_ID`
   - `TRAKT_CLIENT_SECRET`
2. Set (or keep defaults):
   - `TRAKT_API_BASE_URL=https://api.trakt.tv`
   - `TRAKT_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob`
3. Build authorize URL and approve access:

```text
https://trakt.tv/oauth/authorize?response_type=code&client_id=YOUR_TRAKT_CLIENT_ID&redirect_uri=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob
```

4. Exchange the returned code for tokens:

```bash
curl -sS -X POST "https://api.trakt.tv/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{
    "code":"PASTE_AUTHORIZATION_CODE",
    "client_id":"YOUR_TRAKT_CLIENT_ID",
    "client_secret":"YOUR_TRAKT_CLIENT_SECRET",
    "redirect_uri":"urn:ietf:wg:oauth:2.0:oob",
    "grant_type":"authorization_code"
  }'
```

5. Copy `refresh_token` from response JSON into `.env` as `TRAKT_REFRESH_TOKEN`.
6. Set:
   - `TRAKT_SYNC_ENABLED=true`
   - `TRAKT_SYNC_MINS=360` (enforced to `>=40`; values `<=40` become `40`)
   - `TZ=Etc/UTC` (or your Pi timezone, e.g. `Europe/Sofia`) for local date rendering
7. Restart the service.

Notes:
- Sync is interval-gated and persisted to `TRAKT_SYNC_STATE_FILE` so restarts do not force immediate re-sync.
- Refresh-token rotation is persisted to `TRAKT_SYNC_STATE_FILE` for long-running stability.
- Errors fail soft to `UNWATCHED`.
- If Trakt auth/sync is failing, tile line 1 temporarily falls back to the legacy border line.
- `POST /trakt/sync` can be used for local manual sync trigger (loopback/local requests only).
- `GET /status.json` and `GET /health` include watched sync diagnostics (`enabled`, `lastSyncAt`, `nextSyncAt`, `lastSyncError`).

### Release-date fallback chain (movie + episode tiles)

Release date resolution now uses a LAN-first fallback chain:
1. Arr-local metadata (Radarr/Sonarr) first.
2. Trakt lookup second.
3. TMDB lookup last (optional, configure `TMDB_API_READ_ACCESS_TOKEN` or `TMDB_API_KEY`).

Movie logic keeps the current convention and resolves:
`min(release, digital, physical) › inCinema`.

All providers are filtered to valid dates with year `> 1901`, and display remains `DD mmm YY`.

---

## 11) Release and hosting docs

- Hosting/TLS (canonical): [README_HOST.md](README_HOST.md)
- Example env variables: [.env.example](.env.example)
- Systemd example: [deploy/stremio-addarr.service.example](deploy/stremio-addarr.service.example)
