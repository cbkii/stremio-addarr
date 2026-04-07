# Arr Status & Add (`stremio-addarr`)

Self-hosted Stremio add-on that shows Sonarr/Radarr status tiles and provides one-click add actions.

It also exposes two browseable personal catalogs in Stremio Discover/Board:
- **Recent on Radarr** (movies)
- **Recent on Sonarr** (series)
These rows combine active downloads and recent imports from your local Arr services.


This README is the **canonical install and upgrade guide**.

---

## 1) What you will set up

- `stremio-addarr` runs locally on your host at `127.0.0.1:7010`.
- Caddy serves a public HTTPS URL (required for stock Android TV Stremio).
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
- Sonarr and/or Radarr must already be reachable from this host.
- You need a service account and group that exist on your host.

Set these once and reuse them in all commands:

```bash
export SVC_USER="$(whoami)"
export SVC_GROUP="$(id -gn)"
```

If you run the service as a dedicated account, set `SVC_USER`/`SVC_GROUP` to that account instead.

---

## 3) Choose your path

- **Fresh install from scratch** → go to [4) Fresh install](#4-fresh-install-from-scratch)
- **Upgrade existing install** → go to [5) Upgrade existing install](#5-upgrade-existing-install)

---

## 4) Fresh install from scratch

### Step 1 — Download release assets

```bash
gh auth login
gh release download --repo cbkii/stremio-addarr --pattern 'stremio-addarr-install.tar.gz*'
```

### Step 2 — Verify and extract

```bash
sha256sum -c stremio-addarr-install.tar.gz.sha256
file stremio-addarr-install.tar.gz | grep -q 'gzip' \
  || { echo "ERROR: Downloaded file is not a valid gzip archive."; exit 1; }

sudo mkdir -p /opt/stremio-addarr
sudo tar -xzf stremio-addarr-install.tar.gz -C /opt/stremio-addarr --strip-components=1
sudo chown -R "$SVC_USER:$SVC_GROUP" /opt/stremio-addarr
```

### Step 3 — Install production dependencies

```bash
cd /opt/stremio-addarr
npm ci --omit=dev
```

### Step 4 — Configure app environment

```bash
cp .env.example .env
nano .env
```

Set required values:

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

CATALOG_PAGE_SIZE=25
CATALOG_CACHE_TTL_MS=5000
CATALOG_CACHE_MAX_AGE_SEC=15
CATALOG_STALE_REVALIDATE_SEC=60
CATALOG_STALE_ERROR_SEC=120
```

Notes:
- `SONARR_SERIES_MONITOR` maps directly to Sonarr's `addOptions.monitor` field and accepts: `all`, `future`, `missing`, `existing`, `pilot`, `firstSeason`, `latestSeason`, or `none`.
- `SONARR_SERIES_MONITOR` is parsed case-insensitively (`ALL`, `All`, `none` all work).
- `RADARR_TAGS` and `SONARR_TAGS` accept comma-separated integer tag IDs (e.g. `1,3`). Find IDs via Arr → Settings → Tags.
- Catalog cache variables are optional tuning knobs; defaults are production-safe for Pi/LAN use.
- `FORCED_SHUTDOWN_EXIT_CODE=0` keeps orchestrators from flagging timeout-forced stop as a failed exit.

Optional tuning:
- `CATALOG_PAGE_SIZE` (default `25`, max effective `50`): how many cards each catalog page returns.
- `CATALOG_CACHE_TTL_MS` (default `5000`): short in-memory cache for merged Arr queue+history results.
- `CATALOG_CACHE_MAX_AGE_SEC` (default `15`): fresh cache hint sent to Stremio for catalog responses.
- `CATALOG_STALE_REVALIDATE_SEC` (default `60`): stale-while-revalidate hint sent to Stremio.
- `CATALOG_STALE_ERROR_SEC` (default `120`): stale-if-error hint sent to Stremio.
- `TMDB_NEGATIVE_CACHE_TTL_MS` (default `60000`): retry delay after a failed TMDB poster lookup.

### Step 5 — Install systemd service

```bash
sudo cp deploy/stremio-addarr.service.example /etc/systemd/system/stremio-addarr.service
sudo nano /etc/systemd/system/stremio-addarr.service
```

In the service file, replace these placeholders with your real account/group:
- `YOUR_SVC_USER`
- `YOUR_SVC_GROUP`

Then load and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stremio-addarr
```

### Step 6 — Configure hosting/TLS (required)

Follow **README_HOST.md** now: [README_HOST.md](README_HOST.md).

When finished, you must have:
- Caddy serving `https://YOUR_HOSTNAME`
- `PUBLIC_BASE_URL=https://YOUR_HOSTNAME`

### Step 7 — End-to-end verification (required before Stremio install)

Run these checks in order:

```bash
# 1) Local service is running
sudo systemctl is-active stremio-addarr

# 2) Local manifest is reachable
curl -fsS http://127.0.0.1:7010/manifest.json >/dev/null

# 3) Public HTTPS manifest is reachable
curl -fI https://YOUR_HOSTNAME/manifest.json

# 4) Exact URL to paste into Stremio
echo "https://YOUR_HOSTNAME/manifest.json"
```

### Step 8 — Install in Stremio

On Stremio (Android TV):
1. Open **Add-ons**.
2. Open **Community Add-ons** (or search).
3. Paste the manifest URL from Step 7:
   - `https://YOUR_HOSTNAME/manifest.json`
4. Click **Install**.

---

## 5) Upgrade existing install

This keeps your existing `.env` and service wiring, then reapplies ownership and dependencies.

### Step 1 — Download new release

```bash
gh auth login
gh release download --repo cbkii/stremio-addarr --pattern 'stremio-addarr-install.tar.gz*' --dir ~
```

### Step 2 — Verify and extract over existing install

```bash
sha256sum -c ~/stremio-addarr-install.tar.gz.sha256
file ~/stremio-addarr-install.tar.gz | grep -q 'gzip' \
  || { echo "ERROR: Downloaded file is not a valid gzip archive."; exit 1; }

sudo tar -xzf ~/stremio-addarr-install.tar.gz -C /opt/stremio-addarr --strip-components=1
sudo chown -R "$SVC_USER:$SVC_GROUP" /opt/stremio-addarr
```

### Step 3 — Reinstall production dependencies

```bash
cd /opt/stremio-addarr
npm ci --omit=dev
```

### Step 4 — Review config and service account

- Compare your `.env` with the new `.env.example` and add any new required variables.
- Confirm `/etc/systemd/system/stremio-addarr.service` still has your correct `User=` and `Group=`.

If you edited the unit file, reload systemd:

```bash
sudo systemctl daemon-reload
```

### Step 5 — Restart and verify

```bash
sudo systemctl restart stremio-addarr
sudo systemctl is-active stremio-addarr
curl -fsS http://127.0.0.1:7010/manifest.json >/dev/null
curl -fI https://YOUR_HOSTNAME/manifest.json
```

If your hostname/TLS setup changed, re-run the hosting guide: [README_HOST.md](README_HOST.md).

---

## 6) Runtime checks

```bash
sudo journalctl -u stremio-addarr -n 50 --no-pager
curl -fsS http://127.0.0.1:7010/healthz
curl -fsS https://YOUR_HOSTNAME/status.json
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

### Collecting logs — Docker

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

---

## 10) Release and hosting docs

- Hosting/TLS (canonical): [README_HOST.md](README_HOST.md)
- Example env variables: [.env.example](.env.example)
- Systemd example: [deploy/stremio-addarr.service.example](deploy/stremio-addarr.service.example)
