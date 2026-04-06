# Hosting Guide — Arr Status & Add (`stremio-addarr`)

This guide walks you through exposing the add-on over **public HTTPS** so that stock Android TV (Stremio) can install it.

> **Why HTTPS on a real hostname?**
> Android apps targeting API 24+ do not trust user-installed CAs or self-signed
> certificates. Stock Android TV cannot install add-ons served over plain HTTP,
> private IPs, `.local`, or `.lan` hostnames. You need a publicly trusted
> certificate on a real DNS name.

---

## Supported hosting modes

| Mode | Pros | Cons |
|------|------|------|
| **A — DuckDNS + Caddy + Let's Encrypt** | Free, automatic certs, widely documented | Requires router port forwarding (TCP 80 + 443) |
| **B — Tailscale Funnel** | No port forwarding, no router changes | Requires Tailscale account, hostname is `*.ts.net` |

Both modes give you a publicly trusted HTTPS hostname that works on stock Android TV.

---

## Which mode should I choose?

- **Choose Mode A** if you can forward ports 80 and 443 on your router to your Raspberry Pi. This is the default recommended setup.
- **Choose Mode B** if you cannot forward ports (strict ISP, double NAT, mobile hotspot, etc.) or prefer zero router configuration.

---

## Mode A — DuckDNS + Caddy + Let's Encrypt

### Overview

1. Register a free DuckDNS subdomain.
2. Keep the subdomain pointed at your public IP (auto-update script).
3. Forward ports 80/443 on your router to the Pi.
4. Install Caddy on the Pi to reverse-proxy the add-on.
5. Caddy automatically obtains a Let's Encrypt certificate.

### Step 1 — Create a DuckDNS subdomain

1. Go to [https://www.duckdns.org](https://www.duckdns.org) and sign in (GitHub, Google, etc.).
2. Create a subdomain, e.g. `myaddarr`. Your hostname will be `myaddarr.duckdns.org`.
3. Note your **token** (shown at the top of the DuckDNS dashboard).

### Step 2 — Keep DuckDNS updated

On the Pi, create a cron job to update your IP every 5 minutes:

```bash
# Replace YOUR_TOKEN and YOUR_SUBDOMAIN
mkdir -p ~/duckdns
cat > ~/duckdns/duck.sh << 'EOF'
#!/bin/bash
echo url="https://www.duckdns.org/update?domains=YOUR_SUBDOMAIN&token=YOUR_TOKEN&ip=" | curl -k -o ~/duckdns/duck.log -K -
EOF
chmod 700 ~/duckdns/duck.sh

# Test it
~/duckdns/duck.sh
cat ~/duckdns/duck.log   # should say "OK"

# Add cron job
(crontab -l 2>/dev/null; echo "*/5 * * * * ~/duckdns/duck.sh >/dev/null 2>&1") | crontab -
```

### Step 3 — Forward ports on your router

Log into your router admin panel and forward:
- **TCP 80** → Pi's LAN IP (e.g. `192.168.1.100`)
- **TCP 443** → Pi's LAN IP

> The exact steps vary by router. Search "[your router model] port forwarding" for instructions.

### Step 4 — Install Caddy

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
```

### Step 5 — Configure Caddy

Copy the example Caddyfile and edit it:

```bash
sudo cp /opt/stremio-addarr/Caddyfile.example /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Replace `stremio-addarr.example.com` with your DuckDNS hostname:

```caddyfile
myaddarr.duckdns.org {
    encode zstd gzip
    reverse_proxy 127.0.0.1:7010
}
```

Reload Caddy:

```bash
sudo systemctl reload caddy
```

### Step 6 — Configure the add-on

In `/opt/stremio-addarr/.env`, set:

```bash
HOST=127.0.0.1
PORT=7010
PUBLIC_BASE_URL=https://myaddarr.duckdns.org
TARGET_CLIENT=android-tv
```

Restart the add-on:

```bash
sudo systemctl restart stremio-addarr
```

### Step 7 — Verify

```bash
# Check the add-on is running
curl http://127.0.0.1:7010/healthz

# Check Caddy is proxying with a valid cert
curl -I https://myaddarr.duckdns.org/manifest.json
```

You should see `HTTP/2 200` with valid TLS. If Caddy is still obtaining the cert, wait a minute and retry.

---

## Mode B — Tailscale Funnel

### Overview

1. Install Tailscale on the Pi.
2. Enable Tailscale Funnel to expose the add-on publicly.
3. Funnel gives you a `*.ts.net` hostname with automatic HTTPS.
4. No router port forwarding required.

### Step 1 — Create a Tailscale account

Go to [https://tailscale.com](https://tailscale.com) and create a free account.

### Step 2 — Install Tailscale on the Pi

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Follow the authentication link printed in the terminal.

### Step 3 — Enable HTTPS certificates

In the [Tailscale admin console](https://login.tailscale.com/admin/dns):
1. Go to **DNS** settings.
2. Enable **HTTPS Certificates**.

### Step 4 — Start Funnel

Tailscale Funnel exposes a local port to the public internet via Tailscale's edge. Run:

```bash
# Expose port 7010 publicly on port 443
sudo tailscale funnel --bg 7010
```

> **Note:** Tailscale Funnel constrains which ports can be used. Port 443 is the
> default public-facing port. The `--bg` flag runs it in the background.

Your public hostname will be shown in the output, e.g.:
```
https://raspberrypi.tail1234.ts.net/
```

To verify Funnel status:

```bash
tailscale funnel status
```

### Step 5 — Configure the add-on

In `/opt/stremio-addarr/.env`, set:

```bash
HOST=127.0.0.1
PORT=7010
PUBLIC_BASE_URL=https://raspberrypi.tail1234.ts.net
TARGET_CLIENT=android-tv
```

Replace `raspberrypi.tail1234.ts.net` with your actual Tailscale Funnel hostname.

Restart the add-on:

```bash
sudo systemctl restart stremio-addarr
```

### Step 6 — Verify

```bash
# Local check
curl http://127.0.0.1:7010/healthz

# Public check
curl -I https://raspberrypi.tail1234.ts.net/manifest.json
```

You should see `HTTP/2 200` with a valid Tailscale certificate.

### Making Funnel persistent

To ensure Funnel survives reboots, the `--bg` flag keeps it running as a background service. Verify with:

```bash
tailscale funnel status
```

---

## Verification checklist

After completing either mode, verify:

- [ ] `curl http://127.0.0.1:7010/healthz` returns `{"ok":true, ...}`
- [ ] `curl https://YOUR-HOSTNAME/manifest.json` returns valid JSON with no TLS errors
- [ ] `curl https://YOUR-HOSTNAME/status.json` shows service status (no API keys exposed)
- [ ] Opening `https://YOUR-HOSTNAME/manifest.json` in a browser shows the manifest

---

## Android TV compatibility notes

- Stock Android TV (API 24+) **only** trusts system CA certificates.
- You **cannot** install custom CA roots without root access.
- Stremio on Android TV will reject add-ons served over:
  - Plain HTTP (`http://...`)
  - IP addresses (`https://192.168.x.x/...`)
  - `.local` / `.lan` hostnames
  - Self-signed or Caddy internal CA certificates
- Both DuckDNS + Let's Encrypt and Tailscale Funnel provide publicly trusted certificates that work on stock Android TV.

---

## Troubleshooting

### DuckDNS + Caddy issues

| Problem | Solution |
|---------|----------|
| Caddy fails to get a certificate | Ensure ports 80 and 443 are forwarded to the Pi. Check `sudo journalctl -u caddy`. |
| DuckDNS not updating | Run `~/duckdns/duck.sh` manually and check `~/duckdns/duck.log`. Verify your token is correct. |
| "Connection refused" on HTTPS | Ensure Caddy is running: `sudo systemctl status caddy`. Check Caddyfile syntax: `caddy validate --config /etc/caddy/Caddyfile`. |
| Certificate not trusted | Wait a few minutes for ACME provisioning. Ensure the hostname resolves to your public IP: `dig myaddarr.duckdns.org`. |

### Tailscale Funnel issues

| Problem | Solution |
|---------|----------|
| Funnel command not available | Ensure Tailscale is up to date: `sudo tailscale update`. Funnel requires Tailscale 1.38+. |
| "Funnel not available" error | Enable HTTPS certificates in the Tailscale admin console DNS settings. |
| Connection timeout | Check `tailscale funnel status`. Verify the add-on is running on port 7010. |

### General issues

| Problem | Solution |
|---------|----------|
| Add-on not responding | Check `sudo systemctl status stremio-addarr` and `sudo journalctl -u stremio-addarr -n 50`. |
| Stremio cannot install add-on | Ensure `PUBLIC_BASE_URL` exactly matches your HTTPS hostname. Test the manifest URL in a browser first. |
| Arr connection errors | Verify Sonarr/Radarr are reachable from the Pi: `curl http://127.0.0.1:8989/api/v3/system/status?apikey=YOUR_KEY`. |
