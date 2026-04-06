# Hosting Guide — Arr Status & Add (`stremio-addarr`)

This guide shows how to give the add-on a **publicly trusted HTTPS certificate** on a **real DNS hostname** so stock Android TV Stremio can install and use it.

The setup below keeps the add-on **private on your LAN**:

- Caddy terminates HTTPS on the Pi
- the Node app listens only on `127.0.0.1:7010`
- certificates are issued with the **ACME DNS-01 challenge**
- **router port forwarding is not required**

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
    │  ← DNS resolves hostname to the Pi's LAN IP
    ▼
Caddy on Raspberry Pi (port 443)
    │  ACME DNS-01 via DuckDNS or deSEC
    │  reverse proxy
    ▼
Node.js add-on (127.0.0.1:7010 only)
    │  HTTP API
    ▼
Sonarr / Radarr on LAN
```

Key points:
- **DuckDNS A record** points to your Pi's LAN IP (e.g. `192.168.1.100`). It does not need a public IP.
- **Local DNS override** (dnsmasq or Pi-hole) tells every LAN device that `myaddarr.duckdns.org` is at `192.168.1.100`. Without this, LAN devices would query public DNS and might not reach the Pi reliably.
- **Caddy** is the only process on port 443, handles TLS termination, and reverse-proxies to the Node app.
- **Node app** listens only on `127.0.0.1:7010`, never exposed directly.

---

## Before you begin

You will need:
- A **Raspberry Pi** running Raspberry Pi OS (Debian-based) or similar.
- **Node.js 20+** already installed (see main README).
- The **stremio-addarr** add-on already installed in `/opt/stremio-addarr` but not yet started.
- A **DuckDNS** account (free, no credit card), or a domain delegated to **deSEC**.
- Either **dnsmasq** or **Pi-hole** on your LAN for local DNS override.
- `curl` and `dig` (or `nslookup`) available on the Pi.

> **Which local DNS tool do I have?**
> ```bash
> systemctl is-active pihole-FTL || true   # Pi-hole
> systemctl is-active dnsmasq || true      # dnsmasq
> ```
> If you already run Pi-hole on your network, use that. Otherwise, install dnsmasq on the Pi itself:
> `sudo apt install -y dnsmasq` (see Step 6 for the full dnsmasq setup).

---

## Step 1 — Choose a DNS provider

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

> ℹ️ You do NOT need a DuckDNS update cron job for this LAN-only setup. DNS-01 only checks the TXT record during cert issuance — it does not check the A record — so you do not need a public/WAN IP. No port forwarding is required.

### Option B — deSEC (advanced, bring-your-own-domain)

> ⚠️ **Important:** As of mid-2024, deSEC has **suspended new registrations of free `dedyn.io` subdomains**. Existing `dedyn.io` users can continue to use their subdomains. For most beginners, **DuckDNS (Option A) is strongly recommended**.

If you already have a domain and want to use deSEC:

1. Register at [https://desec.io/signup](https://desec.io/signup) (email only, no credit card).
2. Create a domain: add your domain name (e.g. `example.com`) and delegate it to deSEC's nameservers.
3. Create an API token: go to **Token Management** in the deSEC dashboard and create a token scoped to your domain.
4. Note the token — you will need it for the Caddy deSEC plugin.

---

## Step 2 — Install Caddy with the DNS plugin

The **standard Caddy package from APT does not include DNS provider plugins**. You must install a custom Caddy build.

### Clean up old package-managed units first

> ⚠️ **Important:** If you previously installed Caddy from APT and then removed it, the `caddy.service`
> and `caddy-api.service` units may still be **masked** — with
> `/etc/systemd/system/caddy.service` pointing at `/dev/null`. This will block the manual unit
> you create below. Run these cleanup commands before proceeding, even if you think Caddy is
> fully removed:

```bash
sudo systemctl disable --now caddy caddy-api 2>/dev/null || true
sudo systemctl unmask caddy caddy-api 2>/dev/null || true
sudo rm -f /etc/systemd/system/caddy.service /etc/systemd/system/caddy-api.service
sudo systemctl daemon-reload
```

To also remove the APT package (optional):
```bash
sudo apt remove -y caddy
```

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

### Method 2 — Build with xcaddy (alternative, requires Go)

If you prefer to build from source:

```bash
# Install Go and git (needed only for building)
sudo apt install -y golang-go git

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

### Create the caddy service account and directories

Whether you used Method 1 or Method 2:

```bash
getent group caddy >/dev/null || sudo groupadd --system caddy
id -u caddy >/dev/null 2>&1 || sudo useradd --system \
  --gid caddy \
  --create-home \
  --home-dir /var/lib/caddy \
  --shell /usr/sbin/nologin \
  --comment 'Caddy web server' \
  caddy

sudo install -d -m 0755 -o root  -g caddy /etc/caddy
sudo install -d -m 0755 -o caddy -g caddy /var/lib/caddy
```

### Create the caddy.service unit file

> ℹ️ This creates the unit file manually instead of downloading it from the Caddy dist repo.
> Make sure `command -v caddy` points to the custom binary you installed above (usually `/usr/local/bin/caddy`).

```bash
BIN="$(command -v caddy)"
# Confirm this is the custom binary at /usr/local/bin/caddy, not the APT one at /usr/bin/caddy
echo "$BIN"

sudo tee /etc/systemd/system/caddy.service >/dev/null <<EOF
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
EnvironmentFile=/etc/caddy/caddy.env
ExecStart=${BIN} run --environ --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=${BIN} reload --config /etc/caddy/Caddyfile --adapter caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
```

---

## Step 3 — Store your DNS token securely

Never hard-code API tokens directly in the Caddyfile. Store them in an environment file that the systemd service loads automatically via `EnvironmentFile=` (see the unit above).

```bash
# Create the environment file with strict permissions
sudo install -m 600 -o root -g root /dev/null /etc/caddy/caddy.env

# For DuckDNS (replace with your actual token):
echo 'DUCKDNS_TOKEN=your-duckdns-token-here' | sudo tee /etc/caddy/caddy.env > /dev/null

# For deSEC:
# echo 'DESEC_TOKEN=your-desec-token-here' | sudo tee /etc/caddy/caddy.env > /dev/null

# Confirm permissions
ls -l /etc/caddy/caddy.env
# Expected: -rw------- root root
```

> ℹ️ `EnvironmentFile=` is read by systemd as root before dropping to the caddy user, so
> root-only (`600`) permissions are correct. The variable name just needs to match what you use
> in the Caddyfile (e.g. `{env.DUCKDNS_TOKEN}`).

An example file is provided at `deploy/caddy.env.example` in this repo.

---

## Step 4 — Write the Caddyfile

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

> **Advanced:** If you use a delegated DuckDNS subdomain for the ACME DNS-01 challenge (where a
> separate subdomain is delegated to handle the `_acme-challenge` TXT record), set `override_domain`
> inside the `dns duckdns` block. See `Caddyfile.duckdns.example` for details.

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

---

## Step 5 — Validate and start Caddy

```bash
# Reload unit files
sudo systemctl daemon-reload

# Validate the Caddyfile before starting
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

# Enable and start
sudo systemctl enable --now caddy
sudo systemctl status caddy

# Watch logs to confirm cert issuance (may take up to 2 minutes)
sudo journalctl -u caddy -f
# Look for: "certificate obtained successfully"
```

**Useful verification checks:**

```bash
# Confirm the DNS plugin is present in the running binary
caddy list-modules | grep dns.providers

# Confirm systemd uses the correct binary and env file
systemctl cat caddy | grep -E 'ExecStart|ExecReload|EnvironmentFile'

# Confirm the unit file is NOT masked (must not print /dev/null)
readlink -f /etc/systemd/system/caddy.service || true
```

**Expected outcomes:**
- `caddy list-modules` lists `dns.providers.duckdns` (or `dns.providers.desec`)
- `caddy validate` exits cleanly with no errors
- `systemctl status caddy` shows `active (running)`, not masked
- `readlink -f` prints the actual unit file path, not `/dev/null`
- Logs show `certificate obtained successfully`

---

## Step 6 — Set up local DNS override

A **local DNS override** ensures every LAN device reliably resolves the hostname to the Pi's LAN IP. Without it, some routers or DHCP configurations may behave inconsistently with private-IP DNS records.

Replace `192.168.1.100` with your Pi's actual LAN IP and `myaddarr.duckdns.org` with your actual hostname.

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

```bash
# Query the LAN DNS server directly (replace 192.168.1.100 with your Pi's LAN IP)
dig +short myaddarr.duckdns.org @192.168.1.100
# Should return your Pi's LAN IP

# or using nslookup:
nslookup myaddarr.duckdns.org 192.168.1.100
```

---

## Step 7 — Configure the add-on

In `/opt/stremio-addarr/.env`, set:

```bash
HOST=127.0.0.1
PORT=7010
PUBLIC_BASE_URL=https://myaddarr.duckdns.org
TARGET_CLIENT=android-tv
```

Replace `myaddarr.duckdns.org` with your actual hostname. `PUBLIC_BASE_URL` must be the exact HTTPS origin with **no trailing slash** or path.

Restart the add-on:

```bash
sudo systemctl restart stremio-addarr
```

---

## Step 8 — Verify end to end

```bash
# 1. Node app is running on loopback
curl http://127.0.0.1:7010/healthz
# Expected: {"ok":true,...}

# 2. HTTPS via DNS bypass (bypasses LAN DNS to test Caddy/cert independently)
curl -I --resolve myaddarr.duckdns.org:443:192.168.1.100 \
  https://myaddarr.duckdns.org/manifest.json
# Expected: HTTP/2 200

# 3. Normal DNS-based access
curl -I https://myaddarr.duckdns.org/manifest.json
curl https://myaddarr.duckdns.org/status.json
```

> If step 2 (`--resolve`) succeeds but step 3 fails, the problem is your **LAN DNS** — the TV or client is
> not using the local DNS override. Check your Pi-hole/dnsmasq config and DHCP settings.

---

## Step 9 — Install the add-on in Stremio

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

- [ ] `caddy list-modules | grep dns.providers` lists the DuckDNS or deSEC plugin
- [ ] `sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` exits cleanly
- [ ] `systemctl status caddy` shows `active (running)`
- [ ] `readlink -f /etc/systemd/system/caddy.service` does **not** print `/dev/null`
- [ ] `curl http://127.0.0.1:7010/healthz` returns `{"ok":true,...}`
- [ ] `curl -I --resolve myaddarr.duckdns.org:443:192.168.1.100 https://myaddarr.duckdns.org/manifest.json` returns `HTTP/2 200`
- [ ] `dig +short myaddarr.duckdns.org @<Pi-LAN-IP>` returns the Pi's LAN IP
- [ ] Stremio on Android TV successfully installs the add-on from `https://myaddarr.duckdns.org/manifest.json`

---

## Troubleshooting

### `Cannot edit caddy.service: unit is masked`

**Symptom:** `systemctl edit caddy` or `systemctl enable caddy` reports `Unit caddy.service is masked`.

The APT-managed unit left a symlink to `/dev/null`. Run the cleanup from Step 2:

```bash
sudo systemctl disable --now caddy caddy-api 2>/dev/null || true
sudo systemctl unmask caddy caddy-api 2>/dev/null || true
sudo rm -f /etc/systemd/system/caddy.service /etc/systemd/system/caddy-api.service
sudo systemctl daemon-reload
```

Then recreate the unit file as shown in Step 2 and run `systemctl daemon-reload` again.

### Wrong Caddy binary used by systemd

**Symptom:** Caddy starts but the DNS plugin is missing, or `caddy list-modules` on the command line shows the plugin but the service fails.

Check which binary systemd is actually using:

```bash
systemctl cat caddy | grep ExecStart
# Compare with:
command -v caddy
```

If the paths differ, update `ExecStart` in `/etc/systemd/system/caddy.service` to point to the correct binary (usually `/usr/local/bin/caddy`), then run `sudo systemctl daemon-reload && sudo systemctl restart caddy`.

### Missing DNS plugin

**Symptom:** `caddy list-modules | grep dns.providers` shows nothing; Caddyfile fails with `unknown directive: dns`.

You have a Caddy binary without third-party DNS plugins (e.g. from APT). Replace it with the custom binary from Step 2. Confirm: `caddy list-modules | grep dns.providers.duckdns`.

### Token or challenge failure

**Symptom:** Caddy starts but cert issuance fails with `DNS challenge failed` or `unauthorized`.

- Confirm: `sudo cat /etc/caddy/caddy.env` shows the correct token (e.g. `DUCKDNS_TOKEN=xxxxxxxx-xxxx-...`).
- Confirm file permissions: `ls -l /etc/caddy/caddy.env` should show `-rw------- root root`.
- Confirm the service loads it: `systemctl cat caddy | grep EnvironmentFile`.
- After changing the token: `sudo systemctl restart caddy`.

### Caddy serving an internal/self-signed certificate

**Symptom:** `curl -I https://myaddarr.duckdns.org/manifest.json` shows `SSL certificate problem: self signed certificate`.

- This usually means Caddy could not obtain a Let's Encrypt cert and fell back to a self-signed one.
- Check Caddy logs: `sudo journalctl -u caddy -n 100`
- Ensure the Caddyfile has `tls { dns duckdns ... }` and not `tls internal`.
- Confirm the custom Caddy binary includes the DNS plugin (see above).
- Clear Caddy's cert cache to force re-issuance (⚠️ removes all stored certs):
  ```bash
  sudo systemctl stop caddy
  sudo rm -rf /var/lib/caddy/.local/share/caddy
  sudo systemctl start caddy
  sudo journalctl -u caddy -f  # watch for "certificate obtained successfully"
  ```

### DNS resolution on LAN not working

**Symptom:** `dig myaddarr.duckdns.org` returns the wrong IP or no result.

- Confirm the DuckDNS dashboard shows the correct LAN IP.
- If using Pi-hole: check **Local DNS → DNS Records** in the Pi-hole admin.
- If using dnsmasq: check `/etc/dnsmasq.d/stremio-addarr.conf` has the correct address line. Run `sudo dnsmasq --test` to check config syntax.
- Ensure your devices use Pi/dnsmasq as their DNS server. Check DHCP settings on your router.
- Try flushing DNS cache on Android TV: **Settings → Device Preferences → Network → Reset** (or reboot the TV).

### `PUBLIC_BASE_URL` mismatch

**Symptom:** Stremio shows the add-on installed but stream tiles have bad/broken URLs; manifest loads in browser but not in Stremio.

- `PUBLIC_BASE_URL` in `.env` must match the HTTPS hostname **exactly**, including protocol and no trailing slash.
  - ✅ `https://myaddarr.duckdns.org`
  - ❌ `https://myaddarr.duckdns.org/` (trailing slash)
  - ❌ `http://myaddarr.duckdns.org`
  - ❌ `myaddarr.duckdns.org` (missing protocol)
- After changing `.env`, restart the add-on: `sudo systemctl restart stremio-addarr`

### Add-on not listening on loopback

**Symptom:** `curl http://127.0.0.1:7010/healthz` returns connection refused.

- Check service status: `sudo systemctl status stremio-addarr`
- Check logs: `sudo journalctl -u stremio-addarr -n 50`
- Confirm `HOST=127.0.0.1` and `PORT=7010` in `.env` match the Caddy `reverse_proxy` target.

---

## Android TV compatibility notes

- Stock Android TV (API 24+) **only** trusts system CA certificates.
- You **cannot** install custom CA roots without root access.
- The following are **not suitable** for the final add-on URL on stock Android TV:
  - Plain `http://` URLs
  - `https://192.168.x.x` (IP address)
  - `.local` / `.lan` hostnames
  - Self-signed certificates
  - `tls internal` / private CA certificates
- A **public CA certificate** (e.g. Let's Encrypt via DNS-01) on a **real DNS hostname** is required.
- The hostname may resolve to a **private LAN IP** — that is fine. What matters is the certificate is signed by a trusted public CA.
