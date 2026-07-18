# Arr Status & Add (`stremio-addarr`)

A self-hosted Stremio add-on for Radarr and Sonarr.

It adds compact status and action tiles to movie and episode pages, lets you add/search/monitor titles from Stremio, and provides **Recent on Radarr** and **Recent on Sonarr** catalogues.

Designed for a Raspberry Pi or Linux home server with Stremio on Android TV.

## What you need

- A Linux host with `systemd` and Node.js 20 or newer.
- Radarr and/or Sonarr reachable from that host.
- A public HTTPS hostname for Stremio, normally through Caddy and DuckDNS/deSEC.
- `gh`, `curl`, `sudo`, `tar`, `sha256sum`, `file`, `diff` and `nano`.

Check Node first:

```bash
node --version
npm --version
```

## Install

Download and run the guided installer:

```bash
gh release download --repo cbkii/stremio-addarr \
  --pattern quick.sh \
  --output quick.sh \
  --clobber

chmod +x quick.sh
bash quick.sh install
```

The installer:

- downloads and verifies the current release;
- installs under `/opt/stremio-addarr`;
- guides you through `.env` and token setup;
- installs/enables the systemd service;
- checks local and public endpoints;
- prints the exact Stremio manifest and Configure URLs.

By default, the service runs as your current shell user/group. To use another existing account:

```bash
bash quick.sh install \
  --svc-user YOUR_USER \
  --svc-group YOUR_GROUP
```

To install a specific release:

```bash
gh release download vX.Y.Z --repo cbkii/stremio-addarr \
  --pattern quick.sh \
  --output quick.sh \
  --clobber

bash quick.sh install --tag vX.Y.Z
```

## Configure public HTTPS

Stremio on Android TV requires a trusted public HTTPS origin.

Follow **[README_HOST.md](README_HOST.md)** to configure Caddy and your DNS provider. The same hostname must be used by:

- your DNS record;
- the Caddy site address;
- `PUBLIC_BASE_URL` in `/opt/stremio-addarr/.env`.

The add-on listens locally at `127.0.0.1:7010`; Caddy should be the public front door.

## Configure the add-on

`quick.sh` handles two different tokens:

- `ADDON_ACCESS_TOKEN` protects the Stremio transport path.
- `CONFIG_UI_TOKEN` unlocks server settings inside the Configure page.

The installer can keep an existing valid token, accept an eight-character URL-safe value, or generate one. Existing longer tokens continue to work.

When the configuration UI is enabled, open the exact URL printed by the installer:

```text
https://YOUR_HOSTNAME/YOUR_ADDON_ACCESS_TOKEN/configure
```

Use **Save server settings** to update the server configuration. Restart the service when prompted. Use **Install / reinstall in Stremio** only for first installation or after changing `ADDON_ACCESS_TOKEN`.

For setting descriptions and manual `.env` editing, see **[docs/CONFIGURATION.md](docs/CONFIGURATION.md)**. For UI-specific behaviour, see **[docs/CONFIGURATION_UI.md](docs/CONFIGURATION_UI.md)**.

## Install in Stremio

Paste the protected manifest URL printed by `quick.sh` into Stremio:

```text
https://YOUR_HOSTNAME/YOUR_ADDON_ACCESS_TOKEN/manifest.json
```

The plain `/manifest.json` route is intentionally unavailable.

On Android TV:

1. Open **Add-ons**.
2. Open Community Add-ons or the add-on search field.
3. Enter the protected manifest URL.
4. Select **Install**.

## Upgrade

```bash
gh release download --repo cbkii/stremio-addarr \
  --pattern quick.sh \
  --output quick.sh \
  --clobber

chmod +x quick.sh
bash quick.sh upgrade
```

The upgrade keeps your existing configuration, offers token keep/specify/generate choices, reapplies service ownership and dependencies, and verifies the protected endpoints.

For a specific release:

```bash
bash quick.sh upgrade --tag vX.Y.Z
```

Changing `ADDON_ACCESS_TOKEN` changes the Stremio manifest URL, so reinstall the add-on afterwards. Ordinary configuration changes only require the service restart reported by the UI.

## Verify

Check the running service:

```bash
sudo systemctl status stremio-addarr --no-pager -l
systemctl is-active stremio-addarr
```

Check local health and effective status:

```bash
curl -fsS http://127.0.0.1:7010/healthz | python3 -m json.tool
curl -fsS http://127.0.0.1:7010/status.json | python3 -m json.tool
```

Expected results include:

- service state `active`;
- `"ok": true` from `/healthz`;
- the installed version and expected Radarr/Sonarr reachability in `/status.json`.

Then test the exact public protected URL printed by `quick.sh`:

```bash
curl -fsS "https://YOUR_HOSTNAME/YOUR_ADDON_ACCESS_TOKEN/manifest.json" \
  | python3 -m json.tool
```

## Everyday commands

```bash
# Restart after configuration changes
sudo systemctl restart stremio-addarr

# Recent logs
sudo journalctl -u stremio-addarr -n 100 --no-pager -o cat

# Follow logs
sudo journalctl -u stremio-addarr -f -o cat

# Edit server configuration manually
sudo nano /opt/stremio-addarr/.env

# Confirm the installed version
curl -fsS http://127.0.0.1:7010/status.json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])'
```

## Documentation

- **[Hosting and TLS](README_HOST.md)** — Caddy, DuckDNS/deSEC and public HTTPS.
- **[Configuration reference](docs/CONFIGURATION.md)** — common settings, tokens, monitoring, playback and manual `.env` changes.
- **[Configuration UI](docs/CONFIGURATION_UI.md)** — dashboard authentication, saving and Android TV navigation.
- **[Troubleshooting](docs/TROUBLESHOOTING.md)** — startup failures, 404s, Caddy, logs and Arr connectivity.
- **[Trakt watched sync](docs/TRAKT.md)** — guided and manual OAuth setup.
- **[Changelog](CHANGELOG.md)** — unreleased and released behaviour changes.
- **[Contributing and development](CONTRIBUTING.md)** — local development, tests, packaging and pull requests.

## Security basics

- Keep `/opt/stremio-addarr/.env` readable only by the service account.
- Do not publish API keys, configuration tokens or full manifest URLs in issue reports.
- Leave the Node service bound to `127.0.0.1`; expose it through Caddy rather than directly.
- Rotate a token after it has been shared publicly. Changing `ADDON_ACCESS_TOKEN` requires reinstalling the Stremio add-on.

## Licence

See [LICENSE](LICENSE).
