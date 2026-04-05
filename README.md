# stremio-addarr

Self-hosted Stremio add-on that shows **Radarr / Sonarr status** and lets you **add movies or series** directly from Stremio — optimised for Raspberry Pi + Android TV v9.

---

## Architecture

```
Android TV (Stremio)
       │  HTTPS
       ▼
[Raspberry Pi]
   Caddy (port 443, TLS internal)
       │  HTTP
       ▼
   stremio-addarr (Node, port 7010)
       │
       ├──► Radarr  (http://127.0.0.1:7878)
       └──► Sonarr  (http://127.0.0.1:8989)
```

All Arr credentials stay on the Pi. Nothing is exposed in the addon install URL.

---

## Quick Start (Raspberry Pi)

### 1. Prerequisites

- Raspberry Pi running Raspberry Pi OS (64-bit recommended)
- Node.js 20+: `curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs`
- Caddy: `sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list && sudo apt update && sudo apt install caddy`
- Radarr and/or Sonarr already running on the Pi or LAN

### 2. Clone and install

```bash
git clone https://github.com/cbkii/stremio-addarr.git /home/pi/stremio-addarr
cd /home/pi/stremio-addarr
npm install
npm run build
```

### 3. Configure

```bash
cp .env.example .env
nano .env
```

Minimum required settings:

| Variable | Description |
|---|---|
| `PUBLIC_BASE_URL` | HTTPS URL Stremio uses to reach the addon. E.g. `https://stremio-addarr.lan` |
| `RADARR_ENABLED` | `true` to enable Radarr integration |
| `RADARR_BASE_URL` | Radarr address from the Pi. E.g. `http://127.0.0.1:7878` |
| `RADARR_API_KEY` | Radarr API key (Settings → General) |
| `RADARR_ROOT_FOLDER_PATH` | Root folder for movies. E.g. `/data/media/movies` |
| `SONARR_ENABLED` | `true` to enable Sonarr integration |
| `SONARR_BASE_URL` | Sonarr address from the Pi. E.g. `http://127.0.0.1:8989` |
| `SONARR_API_KEY` | Sonarr API key (Settings → General) |
| `SONARR_ROOT_FOLDER_PATH` | Root folder for TV. E.g. `/data/media/tv` |

See [`.env.example`](.env.example) for all options with comments.

### 4. Set up Caddy (LAN HTTPS)

Copy the example Caddyfile:

```bash
sudo cp Caddyfile.example /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Add the Pi's IP to your LAN DNS or `/etc/hosts` on each client:

```
192.168.1.50  stremio-addarr.lan
```

Trust Caddy's local CA (required for Android TV):

```bash
caddy trust
```

The root CA cert is at:
```
/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt
```

Install this on Android TV via adb or a file manager app.

### 5. Run as a systemd service

```bash
sudo cp stremio-addarr.service /etc/systemd/system/
# Edit the file if your user is not 'pi' or path differs
sudo systemctl daemon-reload
sudo systemctl enable --now stremio-addarr
sudo journalctl -u stremio-addarr -f
```

---

## Install the addon in Stremio

### Desktop (testing first)

1. Open `http://127.0.0.1:7010` in a browser
2. Click **Install in Stremio** or copy the manifest URL
3. Paste into Stremio → Addons → Add Addon

### Android TV

1. From a phone or desktop browser, open `https://stremio-addarr.lan`
2. Scan the QR code with your phone, then tap the install link
3. Or install the root CA first, then open the page on Android TV's browser

---

## Stremio stream tiles

On any movie or episode page, the addon shows 1–3 tiles:

**Movies (Radarr):**
- `Radarr • Downloaded` — file is present
- `Radarr • Added` — in library, not downloaded yet
- `Radarr • Missing` — monitored but missing
- `Search in Radarr` — missing and search-on-add is off
- `Add to Radarr + Search` — not yet in Radarr

**Episodes (Sonarr):**
- `Sonarr • Episode Downloaded` — episode file present
- `Sonarr • Episode Missing` — monitored but missing
- `Sonarr • Series Added` — series in library (no episode detail)
- `Add to Sonarr + Search` — series not in Sonarr

Clicking an "Add" or "Search" tile opens a page in the TV browser, completes the action, and provides a **Return to Stremio** button.

---

## Endpoints

| URL | Description |
|---|---|
| `/` | Landing page with install button and status |
| `/manifest.json` | Stremio addon manifest |
| `/stream/movie/:id.json` | Movie stream tiles |
| `/stream/series/:id.json` | Episode stream tiles |
| `/healthz` | Liveness probe: `{"ok":true}` |
| `/status.json` | Detailed diagnostics (Arr reachability, config validity) |
| `/action/movie/:id` | Trigger add movie to Radarr |
| `/action/series/:id` | Trigger add series to Sonarr |

---

## Environment variables

See [`.env.example`](.env.example) for the full list with comments.

Key variables:

| Variable | Default | Description |
|---|---|---|
| `HOST` | `0.0.0.0` | Node bind address |
| `PORT` | `7010` | Node bind port |
| `PUBLIC_BASE_URL` | `http://127.0.0.1:7010` | HTTPS URL for Stremio clients |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `REQUEST_TIMEOUT_MS` | `5000` | Timeout for Arr API calls |
| `STATUS_CACHE_TTL_MS` | `30000` | Cache duration for Arr status |
| `ACTION_CONFIRM` | `false` | Show confirm page before adding |
| `RADARR_SEARCH_ON_ADD` | `true` | Trigger search when adding to Radarr |
| `SONARR_SEARCH_ON_ADD` | `true` | Trigger search when adding to Sonarr |

---

## Troubleshooting

### Addon not reachable from Android TV
- Check `PUBLIC_BASE_URL` is set to `https://stremio-addarr.lan` (or your hostname)
- Confirm Caddy is running: `sudo systemctl status caddy`
- Confirm the LAN hostname resolves: `ping stremio-addarr.lan` from another device
- Check `/status.json` for config warnings

### HTTPS certificate not trusted on Android TV
- Install Caddy's root CA cert on Android TV
- Run `caddy trust` on the Pi to generate it
- Copy `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` to the TV
- On Android TV: Settings → Security → Install from storage

### Radarr / Sonarr unreachable
- Check `RADARR_BASE_URL` / `SONARR_BASE_URL` are correct
- Test from the Pi: `curl http://127.0.0.1:7878/api/v3/system/status -H "X-Api-Key: <key>"`
- Check `/status.json` for `radarr.reachable` / `sonarr.reachable`

### Add action opens browser but nothing happens
- Check `/status.json` for config issues (root folder path, quality profile)
- Check logs: `sudo journalctl -u stremio-addarr -n 50`
- Ensure `RADARR_ROOT_FOLDER_PATH` and `RADARR_QUALITY_PROFILE_ID` match Radarr's settings

### CORS issues
CORS is handled automatically by the Stremio addon SDK. If you see CORS errors, ensure Stremio is accessing the addon via the `PUBLIC_BASE_URL` (HTTPS), not the direct Node port.

### TV navigation / D-pad
- Action result pages are large-target and readable on TV
- The **Return to Stremio** button is the primary action — it uses the `stremio:///detail/...` deep link
- The landing page shows an install QR code — scan from a phone for easier setup

---

## Development

```bash
# Install deps
npm install

# Run in dev mode (hot reload)
npm run dev

# Type check
npm run check

# Run tests
npm test

# Build for production
npm run build
npm start
```

---

## License

MIT
