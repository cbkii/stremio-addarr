# Hosting Guide — Arr Status & Add (`stremio-addarr`)

This guide walks you through getting a **publicly trusted HTTPS certificate** on a **real DNS hostname** so that stock Android TV (Stremio) can install and use the add-on.

---

## Why a trusted certificate?

Android apps targeting API 24+ only trust **system CA certificates**. There is no way to add custom or self-signed CAs without root access. This means:

- ❌ `http://` — rejected
- ❌ `https://192.168.x.x` — no valid cert possible
- ❌ `https://hostname.local` / `.lan` — not publicly resolvable
- ❌ `tls internal` / self-signed / private CA — not trusted on stock Android TV

You need a **Let's Encrypt (or similar public CA) certificate** issued for a **real, publicly registered DNS name** like `myaddarr.duckdns.org`.

**The service itself does NOT need to be internet-accessible.** The certificate is publicly trusted, but Caddy and the add-on can (and should) stay private on your LAN. This is possible because Let's Encrypt's **DNS-01 challenge** proves domain ownership by setting a DNS TXT record — it never connects to your server.

Router port forwarding is **not required** for the setup documented here.

---

## Architecture

```
Android TV (Stremio)
    │  HTTPS  https://myaddarr.duckdns.org/manifest.json
    │  ← DNS: local override resolves hostname → Pi's LAN IP
    ▼
Caddy on Raspberry Pi (port 443)
    │  Let's Encrypt cert via DNS-01 (DuckDNS API, no port forwarding)
    │  reverse proxy
    ▼
Node.js add-on (127.0.0.1:7010, loopback only)
    │  HTTP API
    ▼
Sonarr / Radarr on LAN
```

Key points:
- **DuckDNS A record** points to your Pi's LAN IP (e.g. `192.168.1.100`). It does not need a public IP.
- **Local DNS override** (dnsmasq or Pi-hole) tells every LAN device that `myaddarr.duckdns.org` is at `192.168.1.100`. Without this, LAN devices would query public DNS and might not reach the Pi.
- **Caddy** handles TLS termination and reverse-proxies to the Node app.
- **Node app** listens only on `127.0.0.1:7010`, never exposed directly.

---

## Before you begin

You will need:
- A **Raspberry Pi** running Raspberry Pi OS (Debian-based) or similar.
- **Node.js 20+** already installed (see main README).
- The **stremio-addarr** add-on already installed in `/opt/stremio-addarr` but not yet started.
- A **DuckDNS** account (free, no credit card).
- Either **dnsmasq** or **Pi-hole** on your LAN for local DNS override.
- `curl` and `dig` (or `nslookup`) available on the Pi.

> **Which local DNS tool do I have?**
> If you already run Pi-hole on your network, use that. Otherwise, install dnsmasq on the Pi itself.
> Check: `systemctl is-active pihole-FTL` (Pi-hole) or `systemctl is-active dnsmasq`.

---

## Step 1 — Choose a free DNS provider

### Option A — DuckDNS (recommended, always free)

DuckDNS provides free `*.duckdns.org` subdomains. New registrations are always available.

1. Go to [https://www.duckdns.org](https://www.duckdns.org) and sign in (GitHub, Google, etc.).
2. Under **"add domain"**, type your preferred name (e.g. `myaddarr`) and click **"add domain"**.
   - Your hostname will be `myaddarr.duckdns.org`. Replace `myaddarr` with whatever you choose.
3. Set the **IP address** for the subdomain to your Pi's **LAN IP** (e.g. `192.168.1.100`), not your public/WAN IP. Click **"update ip"**.
   > Tip: find the Pi's LAN IP with `hostname -I | awk '{print $1}'`
4. Note the **token** shown at the top of the DuckDNS dashboard. You will need it for Caddy.

**Expected result:** `myaddarr.duckdns.org` resolves to your Pi's LAN IP in public DNS.

Verify from the Pi:
```bash
dig +short myaddarr.duckdns.org
# Should output your Pi's LAN IP, e.g. 192.168.1.100
```

> ℹ️ You do NOT need a DuckDNS update cron job for this LAN-only setup. The A record should point to your Pi's LAN IP (which you set in the step above) so LAN clients can connect. Let's Encrypt only checks the TXT record for DNS-01 certificate issuance — it does not check the A record — so you do not need a public/WAN IP for the cert to be issued.

### Option B — deSEC (advanced, bring-your-own-domain)

> ⚠️ **Important:** As of mid-2024, deSEC has **suspended new registrations of free `dedyn.io` subdomains**. Their own registration page states: *"dynDNS registrations are suspended at this time."* Existing `dedyn.io` users can continue to use their subdomains.
>
> If you want to use deSEC, you must **bring your own domain name** (registered elsewhere, e.g. Namecheap, Porkbun, or another registrar). You then delegate that domain to deSEC's nameservers and use their free DNS hosting.
>
> **For most beginners, DuckDNS (Option A) is strongly recommended** as it remains fully free and requires no paid domain.

If you already have a domain and want to use deSEC:

1. Register at [https://desec.io/signup](https://desec.io/signup) (email only, no credit card).
2. Create a domain: add your domain name (e.g. `example.com`) and delegate it to deSEC's nameservers.
3. Create an API token: go to **Token Management** in the deSEC dashboard and create a token scoped to your domain.
4. Note the token — you will need it for the Caddy deSEC plugin.

---

## Step 2 — Install Caddy with the DNS plugin

The **standard Caddy package from APT does not include DNS provider plugins**. You must install a custom Caddy build.

### Method 1 — Download from Caddy's official build service (recommended for beginners, no Go required)

The official Caddy download page lets you select plugins and download a prebuilt binary for your platform:

1. On a desktop browser, go to **[https://caddyserver.com/download](https://caddyserver.com/download)**.
2. In the **"Add plugins"** section, search for and add:
   - `github.com/caddy-dns/duckdns` (for DuckDNS)
   - or `github.com/caddy-dns/desec` (for deSEC)
3. Select **Linux** and **ARM64** (Raspberry Pi 4/5) or **ARMv7** (older Pi models).
   > Check your Pi's architecture: `uname -m`
   > - `aarch64` → choose **arm64**
   > - `armv7l` → choose **armv7**
4. Click **Download**. Copy the download URL shown (it is a direct binary URL).

On the Pi, download and install the binary:

```bash
# Replace the URL with the one from the Caddy download page.
# Example URL format — replace "arm64" with "armv7" if your Pi is armv7l:
CADDY_URL="https://caddyserver.com/api/download?os=linux&arch=arm64&p=github.com%2Fcaddy-dns%2Fduckdns"
# For armv7 Pi models:
# CADDY_URL="https://caddyserver.com/api/download?os=linux&arch=arm&arm=7&p=github.com%2Fcaddy-dns%2Fduckdns"

sudo curl -fsSL "$CADDY_URL" -o /usr/local/bin/caddy
sudo chmod +x /usr/local/bin/caddy

# Verify it includes the plugin
/usr/local/bin/caddy list-modules | grep dns.providers.duckdns
# Expected output: dns.providers.duckdns
```

> ⚠️ **Do not use the standard `sudo apt install caddy`** — that package does not include third-party DNS plugins. If you previously installed Caddy via APT, remove it first to avoid conflicts with future APT upgrades:
> ```bash
> sudo apt remove caddy
> sudo systemctl stop caddy 2>/dev/null || true
> ```
> Then install the custom binary at `/usr/local/bin/caddy` as shown above. Ensure the Caddy systemd service uses `/usr/local/bin/caddy` (check with `systemctl cat caddy | grep ExecStart`).

### Method 2 — Build with xcaddy (alternative, requires Go)

If you prefer to build from source:

```bash
# Install Go (needed only for building)
sudo apt install -y golang

# Install xcaddy
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
export PATH="$PATH:$(go env GOPATH)/bin"

# Build Caddy with DuckDNS plugin
xcaddy build --with github.com/caddy-dns/duckdns
# or for deSEC:
# xcaddy build --with github.com/caddy-dns/desec

# Install the resulting binary
sudo mv ./caddy /usr/local/bin/caddy
sudo chmod +x /usr/local/bin/caddy

# Verify
caddy list-modules | grep dns.providers
```

### Install Caddy system files

Whether you used Method 1 or Method 2, set up the Caddy user and directories:

```bash
# Create caddy user (if not already present)
sudo groupadd --system caddy 2>/dev/null || true
sudo useradd --system --gid caddy --create-home --home-dir /var/lib/caddy \
  --shell /usr/sbin/nologin --comment "Caddy web server" caddy 2>/dev/null || true

# Create config directory
sudo mkdir -p /etc/caddy
sudo chown root:caddy /etc/caddy
sudo chmod 750 /etc/caddy

# Create data/log directories
sudo mkdir -p /var/lib/caddy /var/log/caddy
sudo chown -R caddy:caddy /var/lib/caddy /var/log/caddy
```

Install the systemd service:

```bash
# Download the official Caddy systemd service file
sudo curl -fsSL \
  https://raw.githubusercontent.com/caddyserver/dist/master/init/caddy.service \
  -o /etc/systemd/system/caddy.service

sudo systemctl daemon-reload
sudo systemctl enable caddy
```

> If this URL is unavailable, the service file is available at:
> `https://github.com/caddyserver/dist/blob/master/init/caddy.service`

---

## Step 3 — Store your DNS token securely

Never hard-code API tokens directly in the Caddyfile. Store them in an environment file that only root and the caddy user can read.

```bash
# Create the environment file (replace with your actual token)
sudo install -m 600 -o root -g caddy /dev/null /etc/caddy/caddy.env

# For DuckDNS:
echo 'DUCKDNS_TOKEN=your-duckdns-token-here' | sudo tee /etc/caddy/caddy.env > /dev/null

# For deSEC:
# echo 'DESEC_TOKEN=your-desec-token-here' | sudo tee /etc/caddy/caddy.env > /dev/null

# Confirm permissions
ls -l /etc/caddy/caddy.env
# Expected: -rw------- root caddy  (read by root and caddy group only)
```

Tell the Caddy systemd service to load this environment file. Create a drop-in override:

```bash
sudo mkdir -p /etc/systemd/system/caddy.service.d
sudo tee /etc/systemd/system/caddy.service.d/env.conf > /dev/null << 'EOF'
[Service]
EnvironmentFile=/etc/caddy/caddy.env
EOF

sudo systemctl daemon-reload
```

An example file is provided at `deploy/caddy.env.example` in this repo.

---

## Step 4 — Configure Caddy

### For DuckDNS

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null << 'EOF'
# Replace myaddarr with your actual DuckDNS subdomain name
myaddarr.duckdns.org {
    # Obtain certificate via DNS-01 — no port forwarding required
    tls {
        dns duckdns {env.DUCKDNS_TOKEN}
    }

    encode zstd gzip
    reverse_proxy 127.0.0.1:7010
}
EOF
```

See also `Caddyfile.duckdns.example` in the repo root for a copy you can use as a reference.

### For deSEC

```bash
sudo tee /etc/caddy/Caddyfile > /dev/null << 'EOF'
# Replace stremio.example.com with your domain/subdomain hosted on deSEC
stremio.example.com {
    # Obtain certificate via DNS-01 — no port forwarding required
    tls {
        dns desec {
            token {env.DESEC_TOKEN}
        }
    }

    encode zstd gzip
    reverse_proxy 127.0.0.1:7010
}
EOF
```

See also `Caddyfile.desec.example` in the repo root.

### Validate and start Caddy

```bash
# Validate config syntax
sudo caddy validate --config /etc/caddy/Caddyfile

# Start (or restart if already running)
sudo systemctl restart caddy
sudo systemctl status caddy

# Watch logs to confirm cert issuance (may take up to 2 minutes)
sudo journalctl -u caddy -f
# Look for: "certificate obtained successfully"
```

**Expected:** Caddy contacts Let's Encrypt, sets a TXT record via the DuckDNS API, and receives a trusted certificate. This happens automatically — no port forwarding needed.

---

## Step 5 — Set up local DNS override

Your DuckDNS hostname (`myaddarr.duckdns.org`) points to your Pi's LAN IP in public DNS. However, some routers intercept DNS queries and may return incorrect results, or return the LAN IP fine but your clients may cache stale entries. A **local DNS override** ensures every LAN device reliably resolves the hostname to the Pi's LAN IP.

Replace `192.168.1.100` with your Pi's actual LAN IP and `myaddarr.duckdns.org` with your actual hostname in the examples below.

> **Why is this needed?** Without local DNS override, LAN clients query public DNS resolvers. Your DuckDNS A record points to a private LAN IP (`192.168.1.100`), and public DNS will return that private IP. Most of the time this works, but some routers have DNS forwarding quirks, apply aggressive TTL caching, or respond inconsistently for private-IP DNS records. A local DNS override bypasses public DNS entirely for this hostname, gives you instant and reliable resolution, and means the TV always finds the Pi directly on the LAN regardless of how your router handles public DNS queries.

### Option A — Pi-hole local DNS records

1. Open the Pi-hole admin interface: `http://<PI-HOLE-IP>/admin`
2. Go to **Local DNS → DNS Records**.
3. Enter:
   - **Domain:** `myaddarr.duckdns.org`
   - **IP Address:** `192.168.1.100` (your Pi's LAN IP)
4. Click **Add**.

All devices using Pi-hole as their DNS server will now resolve `myaddarr.duckdns.org` to `192.168.1.100`.

### Option B — dnsmasq

If you do not use Pi-hole, install dnsmasq on the Pi (or on whichever device acts as your LAN DNS server):

```bash
sudo apt install -y dnsmasq
```

Add a local override:

```bash
# Replace with your hostname and Pi LAN IP
echo 'address=/myaddarr.duckdns.org/192.168.1.100' \
  | sudo tee /etc/dnsmasq.d/stremio-addarr.conf > /dev/null

sudo systemctl restart dnsmasq
sudo systemctl status dnsmasq
```

Make sure your router hands out the Pi's LAN IP as the DNS server for DHCP clients (or configure each device manually to use the Pi as its DNS server).

### Confirm resolution from a client

From another device on the LAN (e.g. from the Pi itself after the override is active):

```bash
# Should return your Pi's LAN IP, not a public IP
dig +short myaddarr.duckdns.org @192.168.1.100
# or using nslookup:
nslookup myaddarr.duckdns.org 192.168.1.100
```

From Android TV, you can verify with an app like "Network Analyzer" or simply try installing the add-on.

---

## Step 6 — Configure the add-on

In `/opt/stremio-addarr/.env`, set:

```bash
HOST=127.0.0.1
PORT=7010
PUBLIC_BASE_URL=https://myaddarr.duckdns.org
TARGET_CLIENT=android-tv
```

Replace `myaddarr.duckdns.org` with your actual hostname. `PUBLIC_BASE_URL` must be the exact HTTPS origin with no trailing slash or path.

Restart the add-on:

```bash
sudo systemctl restart stremio-addarr
```

---

## Step 7 — Verify

```bash
# 1. Node app is running on loopback
curl http://127.0.0.1:7010/healthz
# Expected: {"ok":true,...}

# 2. Caddy is proxying with a trusted cert (run from the Pi)
curl -I https://myaddarr.duckdns.org/manifest.json
# Expected: HTTP/2 200  (with no TLS errors)

# 3. Full status check
curl https://myaddarr.duckdns.org/status.json
```

If step 2 shows a TLS error, see the Troubleshooting section below.

---

## Step 8 — Install the add-on in Stremio

1. Open Stremio on your Android TV.
2. Go to **Add-ons**.
3. Click the search icon or **Community Add-ons**.
4. Enter your manifest URL:
   ```
   https://myaddarr.duckdns.org/manifest.json
   ```
5. Click **Install**.

The add-on appears as "Arr Status & Add" in your installed add-ons.

---

## Verification checklist

- [ ] `curl http://127.0.0.1:7010/healthz` returns `{"ok":true,...}`
- [ ] `curl -I https://myaddarr.duckdns.org/manifest.json` returns `HTTP/2 200` with no TLS errors
- [ ] `dig +short myaddarr.duckdns.org @<Pi-LAN-IP>` returns the Pi's LAN IP
- [ ] Stremio on Android TV successfully installs the add-on from `https://myaddarr.duckdns.org/manifest.json`
- [ ] Status tiles appear when browsing movies/episodes in Stremio

---

## Troubleshooting

### DNS resolution on LAN not working

**Symptom:** `dig myaddarr.duckdns.org` returns wrong IP or no result.

- Confirm the DuckDNS dashboard shows the correct LAN IP.
- If using Pi-hole: check **Local DNS → DNS Records** in the Pi-hole admin.
- If using dnsmasq: check `/etc/dnsmasq.d/stremio-addarr.conf` has the correct address line. Run `sudo dnsmasq --test` to check config syntax.
- Ensure your devices use Pi/dnsmasq as their DNS server. Check DHCP settings on your router.
- Try flushing DNS cache on Android TV: **Settings → Device Preferences → Network → Reset** (or reboot the TV).

### Certificate issuance failure

**Symptom:** `sudo journalctl -u caddy` shows `ACME challenge failed` or `timeout`.

- Verify your DuckDNS token is correct in `/etc/caddy/caddy.env`.
- Check the `EnvironmentFile` drop-in is loaded: `systemctl cat caddy` should show `EnvironmentFile=/etc/caddy/caddy.env`.
- Run: `sudo systemctl show caddy --property=Environment` to confirm the variable is set.
- Let's Encrypt has rate limits. If you hit them, wait and retry. Use Let's Encrypt staging during testing by adding `acme_ca https://acme-staging-v02.api.letsencrypt.org/directory` inside the global Caddy block.
- Confirm `dig +short TXT _acme-challenge.myaddarr.duckdns.org` shows a TXT record shortly after starting Caddy (Caddy sets this automatically).

### Wrong Caddy build / missing DNS plugin

**Symptom:** `caddy list-modules | grep dns.providers` shows nothing; Caddyfile fails to load with unknown directive `dns`.

- You have the standard APT-installed Caddy binary without DNS plugins.
- Replace it with the custom binary from Step 2. Confirm with: `caddy list-modules | grep dns.providers.duckdns`
- If `/usr/bin/caddy` is the APT binary and you installed the custom one at `/usr/local/bin/caddy`, check which one systemd uses: `systemctl cat caddy | grep ExecStart`. Update the path if needed.

### Wrong or missing token

**Symptom:** Caddy starts but cert issuance fails with `DNS challenge failed` or `unauthorized`.

- Confirm: `sudo cat /etc/caddy/caddy.env` shows the correct token line (e.g. `DUCKDNS_TOKEN=xxxxxxxx-xxxx-...`).
- Confirm file permissions: `ls -l /etc/caddy/caddy.env` should show `rw-------`.
- After changing the token, reload: `sudo systemctl reload caddy`.

### `PUBLIC_BASE_URL` mismatch

**Symptom:** Stremio shows the add-on installed but stream tiles have bad/broken URLs; manifest loads in browser but not in Stremio.

- `PUBLIC_BASE_URL` in `.env` must match the HTTPS hostname **exactly**, including protocol and no trailing slash.
  - ✅ `https://myaddarr.duckdns.org`
  - ❌ `https://myaddarr.duckdns.org/` (trailing slash)
  - ❌ `http://myaddarr.duckdns.org`
  - ❌ `myaddarr.duckdns.org` (missing protocol)
- After changing `.env`, restart the add-on: `sudo systemctl restart stremio-addarr`

### Manifest loads locally but not in Stremio on Android TV

**Symptom:** `curl -I https://myaddarr.duckdns.org/manifest.json` works from the Pi but Stremio fails to install.

- Confirm the Android TV is using the local DNS server (Pi-hole or dnsmasq). Check TV network settings.
- Confirm the TV can reach the Pi on LAN (try pinging the Pi's LAN IP from the TV via a network app).
- Try opening `https://myaddarr.duckdns.org/manifest.json` in a browser on the TV — this tests DNS + TLS + connectivity in one step.

### Add-on not responding (`127.0.0.1:7010` down or wrong port)

**Symptom:** `curl http://127.0.0.1:7010/healthz` returns connection refused.

- Check service status: `sudo systemctl status stremio-addarr`
- Check logs: `sudo journalctl -u stremio-addarr -n 50`
- Confirm `HOST=127.0.0.1` and `PORT=7010` in `.env` match the Caddy `reverse_proxy` target.

### Caddy serving an internal/self-signed certificate

**Symptom:** `curl -I https://myaddarr.duckdns.org/manifest.json` shows TLS error `SSL certificate problem: self signed certificate` or `unable to get local issuer certificate`.

- This usually means Caddy could not obtain a Let's Encrypt cert and fell back to a self-signed one.
- Check Caddy logs: `sudo journalctl -u caddy -n 100`
- Ensure the Caddyfile has the `tls { dns duckdns ... }` block and not `tls internal`.
- Confirm the custom Caddy binary is being used (see "Wrong Caddy build" above).
- Delete Caddy's data directory to force re-issuance (⚠️ this removes all stored certs):
  ```bash
  sudo systemctl stop caddy
  sudo rm -rf /var/lib/caddy/.local/share/caddy
  sudo systemctl start caddy
  sudo journalctl -u caddy -f  # watch for "certificate obtained successfully"
  ```

---

## Android TV compatibility notes

- Stock Android TV (API 24+) **only** trusts system CA certificates.
- You **cannot** install custom CA roots without root access.
- Stremio on Android TV will reject add-ons served over plain HTTP, IP addresses, `.local`/`.lan` hostnames, or self-signed/Caddy internal certificates.
- Let's Encrypt certificates (obtained by Caddy via DNS-01) are trusted by all Android TV devices.
- The hostname can resolve to a private LAN IP — that is fine. What matters is the certificate is signed by a trusted public CA.

