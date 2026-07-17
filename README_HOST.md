# Hosting Guide (`README_HOST.md`)

This is the **canonical hosting/TLS/reverse-proxy guide** for `stremio-addarr`.

Recommended and supported path:
- **Caddy**
- **DuckDNS**
- **HTTPS manifest URL**

Do app install/upgrade first in [README.md](README.md), then return here.

---

## 1) Define your hostname once

Choose one DuckDNS subdomain and use it everywhere.

```bash
export ADDARR_HOSTNAME="replace-this-with-your-subdomain.duckdns.org"
```

From this point on, every place must use the same hostname:
- DuckDNS record
- `/etc/caddy/Caddyfile` site block
- `/opt/stremio-addarr/.env` → `PUBLIC_BASE_URL=https://$ADDARR_HOSTNAME`
- Manifest URL pasted into Stremio

---

## 2) Configure DuckDNS

1. Create/sign in at <https://www.duckdns.org>.
2. Create your subdomain.
3. Set that subdomain to your host LAN IP.
4. Copy your DuckDNS token.

Verify:

```bash
dig +short "$ADDARR_HOSTNAME"
```

It must return your host LAN IP.

---

## 3) Install Caddy with DuckDNS DNS plugin

Do **not** use the stock `apt install caddy` binary for this setup.
The stock Debian/Ubuntu package does not include third-party DNS modules, so
`dns duckdns` will fail.

First remove/disable any package-managed Caddy units:

```bash
sudo systemctl disable --now caddy caddy-api 2>/dev/null || true
sudo systemctl unmask caddy caddy-api 2>/dev/null || true
sudo rm -f /etc/systemd/system/caddy.service /etc/systemd/system/caddy-api.service
sudo apt remove -y caddy 2>/dev/null || true
sudo systemctl daemon-reload
```

Install a custom Caddy binary with the DuckDNS plugin.

### Option A (recommended): download prebuilt custom binary

```bash
ARCH="$(uname -m)"
if [ "$ARCH" = "aarch64" ]; then
  CADDY_URL="https://caddyserver.com/api/download?os=linux&arch=arm64&p=github.com%2Fcaddy-dns%2Fduckdns"
elif [ "$ARCH" = "armv7l" ]; then
  CADDY_URL="https://caddyserver.com/api/download?os=linux&arch=arm&arm=7&p=github.com%2Fcaddy-dns%2Fduckdns"
else
  echo "Unsupported architecture for this quick command: $ARCH"
  echo "Use https://caddyserver.com/download and include github.com/caddy-dns/duckdns"
  exit 1
fi

sudo curl -fsSL "$CADDY_URL" -o /usr/local/bin/caddy
sudo chmod +x /usr/local/bin/caddy
/usr/local/bin/caddy version
/usr/local/bin/caddy list-modules | grep -q dns.providers.duckdns \
  && echo "DuckDNS plugin present" \
  || { echo "ERROR: DuckDNS plugin missing"; exit 1; }
```

### Option B: build with xcaddy (Go required)

Use this if you prefer building locally instead of downloading a prebuilt binary:

```bash
sudo apt update
sudo apt install -y golang-go git

go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
export PATH="$PATH:$(go env GOPATH)/bin"

xcaddy build --with github.com/caddy-dns/duckdns
sudo mv ./caddy /usr/local/bin/caddy
sudo chmod +x /usr/local/bin/caddy

/usr/local/bin/caddy version
/usr/local/bin/caddy list-modules | grep -q dns.providers.duckdns \
  && echo "DuckDNS plugin present" \
  || { echo "ERROR: DuckDNS plugin missing"; exit 1; }
```

---

## 4) Create caddy service account and directories

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

---

## 5) Create `/etc/systemd/system/caddy.service`

Use this exact unit structure so Caddy always loads `/etc/caddy/caddy.env` and
always runs the custom binary from `/usr/local/bin/caddy`.

```bash
sudo tee /etc/systemd/system/caddy.service >/dev/null <<EOF_SERVICE
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
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile --adapter caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF_SERVICE
```

Now reload systemd (required because service file changed):

```bash
sudo systemctl daemon-reload
```

---

## 6) Create the canonical Caddy env file

Canonical path: **`/etc/caddy/caddy.env`**.

```bash
sudo install -m 600 -o root -g root /dev/null /etc/caddy/caddy.env
sudo nano /etc/caddy/caddy.env
```

Set:

```dotenv
DUCKDNS_TOKEN=replace-with-your-real-duckdns-token
```

Use the same variable name everywhere: `DUCKDNS_TOKEN`.

---

## 7) Create `/etc/caddy/Caddyfile`

```bash
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF_CADDY
$ADDARR_HOSTNAME {
    tls {
        dns duckdns {env.DUCKDNS_TOKEN}
    }

    encode zstd gzip

    # Stremio derives this path from /<ADDON_ACCESS_TOKEN>/manifest.json.
    # The rewrite is required for v1.6.1 and harmless on newer releases.
    @tokenConfigure path_regexp tokenConfigure ^/[A-Za-z0-9_-]{4,128}/configure$
    rewrite @tokenConfigure /configure

    reverse_proxy 127.0.0.1:7010
}
EOF_CADDY
```

If you only edit `Caddyfile` or `/etc/caddy/caddy.env`, **do not run daemon-reload**.
Just restart Caddy:

```bash
sudo systemctl restart caddy
```

---

## 8) Start Caddy and verify HTTPS

```bash
sudo /usr/local/bin/caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl is-active caddy
/usr/local/bin/caddy list-modules | grep -q dns.providers.duckdns \
  && echo "DuckDNS plugin present in running binary" \
  || { echo "ERROR: DuckDNS plugin missing"; exit 1; }
curl -fI "https://$ADDARR_HOSTNAME/$ADDON_ACCESS_TOKEN/manifest.json"
```

---

## 9) Local DNS override for LAN clients

Your LAN clients must resolve `$ADDARR_HOSTNAME` to your host LAN IP.

For dnsmasq on your DNS server:

```bash
export ADDARR_LAN_IP="replace-with-your-host-lan-ip"
echo "address=/$ADDARR_HOSTNAME/$ADDARR_LAN_IP" | sudo tee /etc/dnsmasq.d/stremio-addarr.conf >/dev/null
sudo systemctl restart dnsmasq
```

Verify against your LAN DNS server:

```bash
# replace LAN_DNS_IP with the IP of your DNS server (Pi-hole/dnsmasq)
dig +short "$ADDARR_HOSTNAME" @LAN_DNS_IP
```

Expected: your host LAN IP.

---

## 10) Finalize app URL and verify end-to-end

In `/opt/stremio-addarr/.env`:

```dotenv
PUBLIC_BASE_URL=https://YOUR_HOSTNAME
```

Set `YOUR_HOSTNAME` to exactly `$ADDARR_HOSTNAME`, then restart app:

```bash
sudo systemctl restart stremio-addarr
```

If you changed `/opt/stremio-addarr/.env`, restart is mandatory because systemd only reads `EnvironmentFile=` on service start/restart.

Run the complete verification sequence:

```bash
export ADDON_ACCESS_TOKEN="$(sudo sed -n 's/^ADDON_ACCESS_TOKEN=//p' /opt/stremio-addarr/.env | tail -n1)"
# 1) local service is running
sudo systemctl is-active stremio-addarr

# 2) local manifest is reachable
curl -fsS "http://127.0.0.1:7010/$ADDON_ACCESS_TOKEN/manifest.json" >/dev/null

# 3) public HTTPS manifest is reachable
curl -fI "https://$ADDARR_HOSTNAME/$ADDON_ACCESS_TOKEN/manifest.json"

# 4) exact manifest URL to paste into Stremio
echo "https://$ADDARR_HOSTNAME/$ADDON_ACCESS_TOKEN/manifest.json"
```

In Stremio (Android TV):
1. Open **Add-ons**.
2. Open **Community Add-ons** (or search).
3. Paste the exact URL printed above.
4. Click **Install**.


## Protected Configure path

Stremio derives the Configure URL from the installed transport URL. For a manifest installed from `https://HOST/TOKEN/manifest.json`, it opens `https://HOST/TOKEN/configure`. Current releases serve that route directly. The documented Caddy rewrite maps the same path to `/configure` for compatibility with v1.6.1.

Verify both endpoints:

```bash
curl -fI "https://$ADDARR_HOSTNAME/$ADDON_ACCESS_TOKEN/manifest.json"
curl -fI "https://$ADDARR_HOSTNAME/$ADDON_ACCESS_TOKEN/configure"
```
