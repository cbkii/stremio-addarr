# Troubleshooting

Start with the checks below before changing configuration. For installation commands, return to [../README.md](../README.md). For HTTPS/Caddy setup, use [../README_HOST.md](../README_HOST.md).

## Collect the minimum diagnostics

```bash
sudo systemctl status stremio-addarr --no-pager -l
sudo journalctl -u stremio-addarr -n 150 --no-pager -o cat
curl -fsS http://127.0.0.1:7010/healthz | python3 -m json.tool
curl -fsS http://127.0.0.1:7010/status.json | python3 -m json.tool
```

For a fresh failure, show only the current boot or current service invocation:

```bash
sudo journalctl -u stremio-addarr -b --no-pager -o cat
```

Follow live while reproducing a Stremio problem:

```bash
sudo journalctl -u stremio-addarr -f -o cat
```

## Service appears active but keeps restarting

`systemctl status` can briefly show `active` between automatic restart attempts. Check the restart counter and recent logs:

```bash
systemctl show stremio-addarr \
  -p ActiveState \
  -p SubState \
  -p NRestarts \
  -p MainPID

sudo journalctl -u stremio-addarr -n 100 --no-pager -o cat
```

Common configuration failures include missing or invalid tokens, malformed URLs and required secrets that were not set.

After fixing `/opt/stremio-addarr/.env`:

```bash
sudo systemctl reset-failed stremio-addarr
sudo systemctl restart stremio-addarr
sleep 3
systemctl is-active stremio-addarr
```

## `CONFIG_UI_TOKEN must be ...` startup failure

When `CONFIG_UI_ENABLED=true`, `CONFIG_UI_TOKEN` must contain 8–128 URL-safe characters: letters, numbers, `_` or `-`.

Run the upgrade script to keep, specify or generate the token safely:

```bash
bash quick.sh upgrade
```

Or edit the environment file manually and restart:

```bash
sudo nano /opt/stremio-addarr/.env
sudo systemctl restart stremio-addarr
```

`CONFIG_UI_TOKEN` is not the manifest-path token. The protected Stremio URL uses `ADDON_ACCESS_TOKEN`.

## Manifest returns 404

The valid path is token-prefixed:

```text
https://YOUR_HOSTNAME/YOUR_ADDON_ACCESS_TOKEN/manifest.json
```

These are wrong:

```text
https://YOUR_HOSTNAME/manifest.json
https://YOUR_HOSTNAME/YOUR_CONFIG_UI_TOKEN/manifest.json
```

First test Node locally using the actual `ADDON_ACCESS_TOKEN`:

```bash
curl -fsS \
  "http://127.0.0.1:7010/YOUR_ADDON_ACCESS_TOKEN/manifest.json" \
  | python3 -m json.tool
```

Then test the same path through Caddy:

```bash
curl -fsS \
  "https://YOUR_HOSTNAME/YOUR_ADDON_ACCESS_TOKEN/manifest.json" \
  | python3 -m json.tool
```

If local works and public fails, inspect Caddy rather than changing the add-on token.

## Configure page returns `Cannot GET /TOKEN/configure`

Current releases serve both:

```text
/configure
/YOUR_ADDON_ACCESS_TOKEN/configure
```

Test locally and publicly:

```bash
curl -fsS -o /dev/null -w 'local: %{http_code}\n' \
  "http://127.0.0.1:7010/YOUR_ADDON_ACCESS_TOKEN/configure"

curl -fsS -o /dev/null -w 'public: %{http_code}\n' \
  "https://YOUR_HOSTNAME/YOUR_ADDON_ACCESS_TOKEN/configure"
```

Expected status is `200`. If only the public route fails, verify the compatibility rewrite and unrestricted reverse proxy in [../README_HOST.md](../README_HOST.md).

## Caddy or public HTTPS failure

Validate and inspect Caddy:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl status caddy --no-pager -l
sudo journalctl -u caddy -n 100 --no-pager
```

The site should proxy all paths to Node:

```caddyfile
reverse_proxy 127.0.0.1:7010
```

Do not proxy only `/manifest.json`; protected catalogue, stream, action and Configure paths also need to pass through unchanged.

Confirm that:

- DNS points to the correct public IP;
- ports 80 and 443 reach Caddy;
- Caddy has a trusted certificate;
- the Caddy hostname exactly matches `PUBLIC_BASE_URL`.

## Logo URL or manifest image failure

Use:

```dotenv
MANIFEST_LOGO_URL=local
```

Do not use a nested environment expression such as:

```dotenv
MANIFEST_LOGO_URL=https://${PUBLIC_BASE_URL}/assets/logo.png
```

systemd does not expand nested variables in `EnvironmentFile=` values.

## Radarr or Sonarr shows unavailable

Check connectivity from the add-on host:

```bash
curl -fsS http://127.0.0.1:7878/api/v3/system/status \
  -H 'X-Api-Key: YOUR_RADARR_API_KEY' \
  | python3 -m json.tool

curl -fsS http://127.0.0.1:8989/api/v3/system/status \
  -H 'X-Api-Key: YOUR_SONARR_API_KEY' \
  | python3 -m json.tool
```

When Arr is on another machine, replace `127.0.0.1` with its LAN address. Verify the base URL, API key, firewall and service port.

Useful log filter:

```bash
sudo journalctl -u stremio-addarr -n 500 --no-pager -o cat \
  | jq 'select(.level == "warn" or .level == "error")'
```

## Add/search tile does nothing

Reproduce once, then inspect action logs:

```bash
sudo journalctl -u stremio-addarr --since '5 minutes ago' --no-pager -o cat \
  | jq 'select(.message == "Action completed" or .message == "Action execution failed" or .message == "Action rejected by Arr service")'
```

Confirm that the Stremio request reached an `/action/` path and that a later log records the queued result.

## Direct streaming returns 403

The resolved media file must remain inside the configured Radarr or Sonarr root folder.

Check:

1. `RADARR_ROOT_FOLDER_PATH` and `SONARR_ROOT_FOLDER_PATH` use the same path namespace seen by the add-on.
2. The service account can traverse and read the media path.
3. Symlinks and bind mounts resolve beneath the allowed root.
4. The service was restarted after `.env` changes.

## Stale settings or stale Stremio metadata

systemd does not hot-reload `.env`:

```bash
sudo systemctl restart stremio-addarr
```

Normal server setting changes do not require reinstalling the add-on. Reinstall only when `ADDON_ACCESS_TOKEN` changes or Stremio refuses to refresh changed manifest metadata.

## Roll back a configuration change

The configuration UI and installer create backups. List them:

```bash
sudo find /opt/stremio-addarr -maxdepth 1 \
  -type f \
  -name '.env*' \
  -printf '%TY-%Tm-%Td %TH:%TM %p\n' \
  | sort -r
```

Restore the chosen file and restart:

```bash
sudo cp -a /opt/stremio-addarr/.env.backup-YYYYMMDD-HHMMSS \
  /opt/stremio-addarr/.env
sudo systemctl restart stremio-addarr
```

## Reporting a problem

Include:

- release version from `/status.json`;
- exact symptom and time;
- whether the local or public URL fails;
- service and Caddy status;
- relevant logs with API keys, tokens and full protected URLs redacted.
