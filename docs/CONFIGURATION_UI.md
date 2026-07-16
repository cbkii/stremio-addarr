# In-Stremio configuration UI

When `CONFIG_UI_ENABLED=true`, When `CONFIG_UI_ENABLED=true`, `stremio-addarr` advertises Stremio's standard `configurable` behaviour hint. The **Configure** action opens:

```text
https://YOUR_PUBLIC_BASE_URL/configure
```

The page is intentionally built with server-rendered HTML, native browser controls, a small JavaScript module and TV-first CSS. It does not put Radarr, Sonarr, Trakt or TMDB credentials in the manifest URL.

## Enable editing

Add a long random administrator token to the same environment file used by the systemd service:

```bash
openssl rand -base64 32
sudoedit /opt/stremio-addarr/.env
```

```dotenv
CONFIG_UI_ENABLED=true
CONFIG_UI_ENABLED=true
CONFIG_UI_TOKEN=replace-with-the-generated-value
CONFIG_UI_ENV_FILE=/opt/stremio-addarr/.env
```

Then restart:

```bash
sudo systemctl restart stremio-addarr
```

When `CONFIG_UI_ENABLED` is false, `/configure` and the Configure behaviour hint are not exposed. When enabled, `CONFIG_UI_TOKEN` must be at least 16 characters. Existing environment-managed installations remain supported, but release 1.6 requires reinstalling through the tokenised manifest URL.

## What the UI manages

The UI can update operational settings for:

- Radarr and Sonarr connections, root folders, profiles, tags and add/search behaviour;
- catalogue page size and watched-item allowance;
- Kodi fallback and direct-file playback mode;
- Trakt watched-sync credentials and interval;
- TMDB fallback token and region.

Bootstrap and process settings remain environment-managed, including:

- `HOST`, `PORT`, `PUBLIC_BASE_URL`, `TARGET_CLIENT`, `TZ` and logging;
- shutdown settings;
- `CONFIG_UI_TOKEN` and `CONFIG_UI_ENV_FILE`;
- `FILE_STREAMING_SECRET`;
- reverse-proxy, TLS and systemd configuration.

## Save and activation model

Saving does not mutate live clients in place. The server:

1. validates the complete submitted configuration;
2. updates only an explicit allow-list of keys;
3. preserves comments and unrelated environment entries;
4. writes a temporary file with mode `0600`;
5. keeps the previous file as `.env.bak`;
6. atomically renames the validated file into place.

Restart the service to activate changes:

```bash
sudo systemctl restart stremio-addarr
sudo systemctl status stremio-addarr --no-pager
journalctl -u stremio-addarr -n 100 --no-pager
```

Rollback:

```bash
sudo cp /opt/stremio-addarr/.env.bak /opt/stremio-addarr/.env
sudo chmod 0600 /opt/stremio-addarr/.env
sudo systemctl restart stremio-addarr
```

## Security model

- Credentials remain server-side and are never encoded into the Stremio install URL.
- Secret fields are returned only as configured/not-configured flags.
- Empty secret fields mean **keep the existing value**.
- Login comparisons are constant-time and failed logins are rate-limited per client address.
- Successful login creates a random, HTTP-only, `SameSite=Strict` session cookie.
- Configuration changes require a per-session CSRF token.
- State-changing requests reject a mismatched browser `Origin` header.
- Configuration responses are `no-store` and use a restrictive Content Security Policy.
- Configuration API routes are deliberately excluded from wildcard Stremio CORS handling.

Treat the configuration token like an administrator password. Keep the add-on behind the documented HTTPS Caddy front door.

## Android TV operation

The page uses:

- large native controls;
- strong multi-signal focus styling;
- predictable document order;
- D-pad-compatible buttons and selects;
- one-column form sections;
- an always-available save bar;
- Back/Escape behaviour that returns to Overview before leaving the page.

Text-heavy entry is usually more comfortable through Stremio Web or a phone browser using the same `/configure` URL. The resulting server-side configuration applies to every installed client using this add-on instance.

## Connection tests and discovery

**Test & discover options** validates candidate Radarr/Sonarr URL and API-key values without saving them. It then queries:

- `/api/v3/system/status`;
- `/api/v3/rootfolder`;
- `/api/v3/qualityprofile`;
- `/api/v3/tag`;
- `/api/v3/languageprofile` for Sonarr when available.

Tests use the server's existing request timeout and never return the submitted API key. Trakt refresh credentials are not tested by rotating a token from the browser; they are validated locally and exercised by the normal Trakt startup/sync flow after restart.

## Install links

The Overview page provides both:

```text
stremio://YOUR_HOST/OPAQUE_INSTALL_TOKEN/manifest.json
https://YOUR_HOST/OPAQUE_INSTALL_TOKEN/manifest.json
```

The custom-protocol link returns to Stremio. The HTTPS URL is suitable for copying into Stremio manually when custom-protocol handling is unavailable.

## Protected installation URL

Release 1.6 requires `ADDON_ACCESS_TOKEN`. The Stremio manifest is served below an opaque path such as:

`https://addarr.example/your-random-token/manifest.json`

The configuration UI displays the complete install URL only after administrator authentication. Health and logs redact this token. Rotate it by changing the environment variable, restarting the service, and reinstalling the add-on.

## Docker permissions

The container runs as UID/GID 10001. Create and secure the writable configuration path before startup:

`install -d -m 0700 -o 10001 -g 10001 config`
`install -m 0600 -o 10001 -g 10001 .env config/.env`

Use `CONFIG_UI_RESTART_COMMAND` to display deployment-appropriate restart instructions.
