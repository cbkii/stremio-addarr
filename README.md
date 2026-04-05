# Arr Status & Add (`stremio-addarr`)

Lightweight, self-hosted Stremio add-on for Raspberry Pi that shows Sonarr/Radarr download status and lets you add movies or series directly from Stremio.

**Primary deployment target:** Raspberry Pi + stock Android TV (Stremio).

---

## 1 — What this add-on does

When you browse a movie or TV episode in Stremio, this add-on shows stream tiles with real-time Arr status:

| Tile | Meaning |
|------|---------|
| `✅ Radarr • Downloaded` | Movie is downloaded |
| `📌 Radarr • Added` | Movie is in Radarr, not yet downloaded |
| `🔎 Radarr • Missing` | Movie is monitored but missing |
| `➕ Add to Radarr + Search` | Click to add the movie and trigger a search |
| `✅ Sonarr • Episode Downloaded` | Episode is downloaded |
| `🔎 Sonarr • Episode Missing` | Episode is monitored but missing |
| `📌 Sonarr • Series Added` | Series exists in Sonarr |
| `➕ Add to Sonarr + Search` | Click to add the series and trigger a search |
| `🛑 Arr Offline` | Cannot reach Sonarr/Radarr |

**Action flow:** Click an add tile → server adds to Arr and triggers search → Stremio redirects back → next refresh shows the updated status.

---

## 2 — Why HTTPS and a public hostname matter

Stock Android TV (API 24+) **only trusts system CA certificates**. This means:

- ❌ `http://...` — blocked or untrusted
- ❌ `https://192.168.x.x` — no valid certificate possible
- ❌ `https://hostname.local` / `.lan` — not publicly resolvable
- ❌ Self-signed or internal CA certificates — not trusted without root

**You need a publicly trusted HTTPS certificate on a real DNS hostname.**

This project supports two beginner-safe hosting modes:

| Mode | Description |
|------|-------------|
| **DuckDNS + Caddy + Let's Encrypt** | Free dynamic DNS + automatic HTTPS. Requires router port forwarding. *(Recommended default)* |
| **Tailscale Funnel** | No port forwarding needed. Public HTTPS via `*.ts.net`. |

See [README_HOST.md](README_HOST.md) for full step-by-step setup.

---

## 3 — Quick install from release

```bash
# Download the latest release
curl -LO https://github.com/cbkii/stremio-addarr/releases/latest/download/stremio-addarr-install.tar.gz

# Optional: verify checksum
curl -LO https://github.com/cbkii/stremio-addarr/releases/latest/download/stremio-addarr-install.tar.gz.sha256
sha256sum -c stremio-addarr-install.tar.gz.sha256

# Extract to /opt/stremio-addarr
sudo mkdir -p /opt/stremio-addarr
sudo tar -xzf stremio-addarr-install.tar.gz -C /opt/stremio-addarr --strip-components=1
cd /opt/stremio-addarr

# Install production dependencies
npm ci --omit=dev
```

Continue with the sections below to configure and run the add-on.

---

## 4 — Prerequisites

- **Raspberry Pi** (or similar Linux host) with Node.js 20+
- **Sonarr** and/or **Radarr** running and accessible from the Pi
- **Stremio** installed on your Android TV (or other client)
- A hosting setup for public HTTPS (see next section)

Install Node.js 20 on Raspberry Pi OS:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version   # should show v20.x.x
```

---

## 5 — Choose a hosting mode

Before installing the add-on, decide how you will expose it over HTTPS.

| Mode | When to choose |
|------|----------------|
| **DuckDNS + Caddy + Let's Encrypt** | You can forward ports 80 + 443 on your router. *(Recommended)* |
| **Tailscale Funnel** | You cannot forward ports (strict ISP, double NAT, etc.). |

👉 **Follow the full setup instructions in [README_HOST.md](README_HOST.md) now**, then come back here to continue.

You will need your public HTTPS hostname (e.g. `myaddarr.duckdns.org` or `raspberrypi.tail1234.ts.net`) for the next steps.

---

## 6 — Configure Sonarr and Radarr

The add-on needs API access to your Arr instances. Here is how to find each value.

### Radarr configuration

| Setting | Where to find it | `.env` variable |
|---------|-------------------|-----------------|
| **Base URL** | Radarr is usually at `http://127.0.0.1:7878` (same Pi) or `http://LAN-IP:7878` | `RADARR_BASE_URL` |
| **API Key** | Radarr → Settings → General → Security → API Key | `RADARR_API_KEY` |
| **Root Folder Path** | Radarr → Settings → Media Management → Root Folders (e.g. `/media/movies`) | `RADARR_ROOT_FOLDER_PATH` |
| **Quality Profile ID** | Radarr → Settings → Profiles → click a profile → the number in the URL (e.g. `1`) | `RADARR_QUALITY_PROFILE_ID` |
| **Minimum Availability** | When Radarr considers a movie available: `announced`, `inCinemas`, `released`, `preDB` | `RADARR_MINIMUM_AVAILABILITY` |
| **Search on Add** | `true` to automatically search when a movie is added | `RADARR_SEARCH_ON_ADD` |
| **Tags** | Optional comma-separated tag IDs to apply | `RADARR_TAGS` |

### Sonarr configuration

| Setting | Where to find it | `.env` variable |
|---------|-------------------|-----------------|
| **Base URL** | Sonarr is usually at `http://127.0.0.1:8989` (same Pi) or `http://LAN-IP:8989` | `SONARR_BASE_URL` |
| **API Key** | Sonarr → Settings → General → Security → API Key | `SONARR_API_KEY` |
| **Root Folder Path** | Sonarr → Settings → Media Management → Root Folders (e.g. `/media/tv`) | `SONARR_ROOT_FOLDER_PATH` |
| **Quality Profile ID** | Sonarr → Settings → Profiles → click a profile → the number in the URL (e.g. `1`) | `SONARR_QUALITY_PROFILE_ID` |
| **Language Profile ID** | Sonarr → Settings → Profiles → Language Profiles → click a profile → ID in URL. Required on Sonarr v3. | `SONARR_LANGUAGE_PROFILE_ID` |
| **Series Monitor** | Which episodes to monitor: `all`, `future`, `missing`, `unaired`, `none` | `SONARR_SERIES_MONITOR` |
| **Search on Add** | `true` to automatically search when a series is added | `SONARR_SEARCH_ON_ADD` |
| **Tags** | Optional comma-separated tag IDs to apply | `SONARR_TAGS` |

> **Tip:** You can verify API access with:
> ```bash
> curl http://127.0.0.1:7878/api/v3/system/status -H "X-Api-Key: YOUR_RADARR_KEY"
> curl http://127.0.0.1:8989/api/v3/system/status -H "X-Api-Key: YOUR_SONARR_KEY"
> ```

---

## 7 — Install the release on Raspberry Pi

If you haven't already extracted the release (section 3), do so now:

```bash
sudo mkdir -p /opt/stremio-addarr
sudo tar -xzf stremio-addarr-install.tar.gz -C /opt/stremio-addarr --strip-components=1
cd /opt/stremio-addarr
npm ci --omit=dev
```

---

## 8 — Configure `.env`

```bash
cp .env.example .env
nano .env
```

Set at minimum:

```bash
HOST=127.0.0.1
PORT=7010
PUBLIC_BASE_URL=https://YOUR-HOSTNAME    # your DuckDNS or Tailscale hostname
TARGET_CLIENT=android-tv

RADARR_ENABLED=true
RADARR_BASE_URL=http://127.0.0.1:7878
RADARR_API_KEY=your-radarr-api-key
RADARR_ROOT_FOLDER_PATH=/media/movies
RADARR_QUALITY_PROFILE_ID=1

SONARR_ENABLED=true
SONARR_BASE_URL=http://127.0.0.1:8989
SONARR_API_KEY=your-sonarr-api-key
SONARR_ROOT_FOLDER_PATH=/media/tv
SONARR_QUALITY_PROFILE_ID=1
SONARR_LANGUAGE_PROFILE_ID=1
```

See `.env.example` for all available options.

---

## 9 — Run and enable the add-on

### Using systemd (recommended)

```bash
sudo cp deploy/stremio-addarr.service.example /etc/systemd/system/stremio-addarr.service
sudo systemctl daemon-reload
sudo systemctl enable --now stremio-addarr
```

Check it is running:

```bash
sudo systemctl status stremio-addarr
sudo journalctl -u stremio-addarr -n 20
```

### Manual run (for testing)

```bash
cd /opt/stremio-addarr
node dist/src/index.js
```

---

## 10 — Set up hosting

If you haven't already completed hosting setup, do so now:

👉 **[README_HOST.md](README_HOST.md)** — step-by-step DuckDNS + Caddy or Tailscale Funnel setup.

---

## 11 — Verify health and public URL

```bash
# Local health check
curl http://127.0.0.1:7010/healthz

# Public manifest (should return JSON with no TLS errors)
curl -I https://YOUR-HOSTNAME/manifest.json

# Full status (no secrets exposed)
curl https://YOUR-HOSTNAME/status.json
```

### Diagnostics endpoints

| Endpoint | Purpose |
|----------|---------|
| `GET /healthz` | Liveness check + Android TV compatibility summary |
| `GET /status.json` | Machine-readable diagnostics (bind address, URL flags, Arr reachability) |
| `GET /health` | Service health summary |

No secrets are exposed in any diagnostic output.

---

## 12 — Install the add-on in Stremio

1. Open Stremio on your Android TV (or any client).
2. Go to the **Add-ons** section.
3. Click **Community Add-ons** or the search icon.
4. Enter your add-on URL:
   ```
   https://YOUR-HOSTNAME/manifest.json
   ```
5. Click **Install**.
6. The add-on appears as "Arr Status & Add" in your installed add-ons.

---

## 13 — Verify it works

1. Browse to any movie or TV episode in Stremio.
2. Open the **Streams** tab.
3. You should see status tiles like `✅ Radarr • Downloaded` or `➕ Add to Radarr + Search`.
4. Click an add tile to test adding a movie/series.
5. Refresh — the status should update.

---

## 14 — Upgrade from a previous release

```bash
# Download the new release
curl -LO https://github.com/cbkii/stremio-addarr/releases/latest/download/stremio-addarr-install.tar.gz

# Extract over existing installation
cd /opt/stremio-addarr
sudo tar -xzf ~/stremio-addarr-install.tar.gz --strip-components=1

# Update dependencies
npm ci --omit=dev

# Restart
sudo systemctl restart stremio-addarr

# Verify
curl http://127.0.0.1:7010/healthz
```

Your `.env` file is preserved — the archive does not include `.env`.

---

## 15 — Troubleshooting

| Problem | Solution |
|---------|----------|
| Add-on not starting | Check logs: `sudo journalctl -u stremio-addarr -n 50` |
| "Arr Offline" tiles | Verify Arr URLs and API keys in `.env`. Test with `curl`. |
| Stremio can't install add-on | Ensure `PUBLIC_BASE_URL` matches your HTTPS hostname exactly. Test in a browser. |
| Certificate not trusted | See [README_HOST.md — Troubleshooting](README_HOST.md#troubleshooting). |
| Port already in use | Change `PORT` in `.env` and update Caddy/Funnel config to match. |
| Tiles show stale status | Cache TTL is configurable via `STATUS_CACHE_TTL_MS` in `.env`. Default is 30 seconds. |

---

## 16 — Maintainer release process

### Supported release paths

| Trigger | How | When to use |
|---------|-----|-------------|
| **Tag push** | `git tag v1.2.3 && git push origin v1.2.3` | Standard release from main branch |
| **Manual dispatch** | Actions → Release → Run workflow → enter version | Release without pushing a tag locally |
| **PR comment** | Comment `/release` on a PR | Release from a PR branch (maintainers only) |
| **PR comment dry-run** | Comment `/release-dry-run` on a PR | Test the build/package without publishing |

### What happens

1. CI runs typecheck, tests, and build.
2. `scripts/package-release.mjs` produces:
   - `stremio-addarr-install.tar.gz` — primary install archive
   - `stremio-addarr-install.tar.gz.sha256` — SHA-256 checksum
3. A GitHub Release is created (or skipped for dry-run) with:
   - Both assets attached
   - Release notes with install/upgrade/hosting instructions
   - Links to tag-specific `README.md` and `README_HOST.md`
   - Marked as `latest`

### PR comment commands

Only repository **collaborators**, **members**, and **owners** may trigger releases via PR comments. Comments on issues (not PRs) are ignored.

| Command | Effect |
|---------|--------|
| `/release` | Full build → tag → publish release |
| `/release-dry-run` | Full build → verify archive → no publish |

Progress is reported via emoji reactions (🚀 on start, 👎 if unauthorised) and a follow-up comment with the result.

### Stable download URL

Users can always download the latest release at:
```
https://github.com/cbkii/stremio-addarr/releases/latest/download/stremio-addarr-install.tar.gz
```

---

## Architecture

```
Stremio (Android TV)
    ↓ HTTPS
Caddy / Tailscale Funnel (public hostname, port 443)
    ↓ HTTP
Node.js add-on (127.0.0.1:7010)
    ↓ HTTP
Sonarr / Radarr (LAN)
```

- Node app binds to `127.0.0.1:7010` (private, not exposed directly).
- Caddy or Tailscale Funnel handles TLS termination.
- `PUBLIC_BASE_URL` always points to the public HTTPS hostname.
- All Arr credentials stay server-side in `.env`.

---

## Configuration reference

See `.env.example` for all available settings. Key variables:

| Variable | Purpose |
|----------|---------|
| `HOST`, `PORT` | Private Node bind address/port (default `127.0.0.1:7010`) |
| `PUBLIC_BASE_URL` | Public HTTPS URL for Stremio-facing links |
| `TARGET_CLIENT` | `android-tv` (strict, default) or `generic` (advanced) |
| `REQUEST_TIMEOUT_MS` | Per-request Arr timeout (default 5000ms) |
| `STATUS_CACHE_TTL_MS` | Status cache TTL (default 30000ms) |
| `SERVICE_HEALTH_CACHE_TTL_MS` | Health check cache TTL (default 10000ms) |
| `RADARR_*` | Radarr connection and add settings |
| `SONARR_*` | Sonarr connection and add settings |

### `PUBLIC_BASE_URL` validation

The add-on validates `PUBLIC_BASE_URL` at startup and warns when:
- HTTP is used
- Hostname is an IP address
- Hostname is internal-only (`.local`, `.lan`, `localhost`)
- Path prefix is configured

In `TARGET_CLIENT=android-tv` mode, these warnings flag as "Android TV compatibility likely broken".

---

## Advanced mode

`TARGET_CLIENT=generic` allows HTTP, IP, and internal hostname setups. **Not recommended** for stock Android TV — only use if you control the client's certificate trust store.

---

## Local development

```bash
npm run typecheck
npm test
npm run build
npm run dev          # watch mode with tsx
```
