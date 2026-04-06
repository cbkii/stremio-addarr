# Arr Status & Add (`stremio-addarr`)

Self-hosted Stremio add-on that shows Sonarr/Radarr status tiles and provides one-click add actions.

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
file stremio-addarr-install.tar.gz | grep -q 'gzip'

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
```

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
file ~/stremio-addarr-install.tar.gz | grep -q 'gzip'

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

## 7) Release and hosting docs

- Hosting/TLS (canonical): [README_HOST.md](README_HOST.md)
- Example env variables: [.env.example](.env.example)
- Systemd example: [deploy/stremio-addarr.service.example](deploy/stremio-addarr.service.example)
