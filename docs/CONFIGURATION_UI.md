# Configuration UI

This guide explains the browser/Android TV dashboard. For setting meanings and manual `.env` changes, use [CONFIGURATION.md](CONFIGURATION.md). For public HTTPS, use [../README_HOST.md](../README_HOST.md).

## Open the dashboard

When `CONFIG_UI_ENABLED=true`, Stremio's **Configure** action opens the token-derived URL:

```text
https://YOUR_HOSTNAME/YOUR_ADDON_ACCESS_TOKEN/configure
```

`quick.sh` prints this exact URL after install or upgrade.

The page asks for `CONFIG_UI_TOKEN`. This administrator token is separate from `ADDON_ACCESS_TOKEN` and never belongs in the manifest URL.

## Enable or repair access

The recommended method is to rerun the guided upgrade:

```bash
bash quick.sh upgrade
```

It can keep, specify or generate both tokens and verifies the resulting Configure route.

For manual setup:

```dotenv
CONFIG_UI_ENABLED=true
CONFIG_UI_TOKEN=YOUR_URL_SAFE_ADMIN_TOKEN
CONFIG_UI_ENV_FILE=/opt/stremio-addarr/.env
```

The token must contain 8–128 letters, numbers, `_` or `-`. Restart after editing:

```bash
sudo systemctl restart stremio-addarr
```

## What the UI manages

The dashboard manages the normal operational settings for:

- Radarr and Sonarr connections, profiles, roots, tags and actions;
- Sonarr monitoring behaviour;
- catalogue sizing;
- Kodi and direct-stream playback;
- Trakt watched sync;
- TMDB fallback.

Bootstrap and infrastructure settings remain environment-managed, including `HOST`, `PORT`, `PUBLIC_BASE_URL`, `CONFIG_UI_TOKEN`, `FILE_STREAMING_SECRET`, systemd and Caddy.

See [CONFIGURATION.md](CONFIGURATION.md) for the setting reference and [../.env.example](../.env.example) for the exhaustive variable list.

## Saving versus installing

**Save server settings** validates and writes the managed `.env` values. Restart the service when prompted:

```bash
sudo systemctl restart stremio-addarr
```

Saving ordinary settings does not require reinstalling the Stremio add-on.

**Install / reinstall in Stremio** opens the protected manifest URL. Use it only:

- for first installation;
- after changing `ADDON_ACCESS_TOKEN`;
- when Stremio will not refresh changed manifest metadata.

## Android TV remote navigation

The UI uses native dropdowns for every Enabled/Disabled setting because checkboxes are unreliable on some TV browsers.

- Up/Down moves through visible controls in document order.
- Left/Right leaves number and dropdown controls and moves between tabs where appropriate.
- Number inputs do not trap Up/Down merely to increment values.
- Back/Escape first leaves the active field, then returns to Overview, before the browser exits.
- The save action is reached after the normal page controls rather than becoming the first focus target.
- Wide landscape screens use multiple columns; narrow screens collapse to one column.

Text-heavy values such as API keys are usually easier to enter from a phone or desktop browser using the same Configure URL. Saved settings apply to every Stremio client using this server.

## Connection tests

**Test & discover options** checks the entered Radarr/Sonarr URL and API key without saving them. It discovers available root folders, quality profiles, tags and Sonarr language profiles where supported.

A successful test does not activate unsaved settings. Select the desired options, then use **Save server settings** and restart when prompted.

## Safe write and rollback behaviour

On save, the server:

1. validates the complete submitted configuration;
2. updates only its managed allow-list of keys;
3. preserves comments and unrelated `.env` entries;
4. writes with mode `0600`;
5. keeps the previous file as `.env.bak`;
6. atomically replaces the active file.

Rollback:

```bash
sudo cp -a /opt/stremio-addarr/.env.bak /opt/stremio-addarr/.env
sudo chmod 0600 /opt/stremio-addarr/.env
sudo systemctl restart stremio-addarr
```

## Security model

- Credentials remain server-side and are not encoded into the install URL.
- Secret fields return only configured/not-configured state; leaving a secret field empty keeps its existing value.
- Login comparison is constant-time and failed logins are rate-limited.
- Sessions use an HTTP-only `SameSite=Strict` cookie and CSRF token.
- Configuration responses are `no-store` and use a restrictive Content Security Policy.
- State-changing requests reject mismatched browser origins.

Keep the dashboard behind the documented Caddy HTTPS front door and treat `CONFIG_UI_TOKEN` as an administrator password.

## Troubleshooting

Use [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for:

- `Cannot GET /TOKEN/configure`;
- blank/white Configure screens;
- authentication failures;
- service restart loops;
- Caddy route or certificate failures.
