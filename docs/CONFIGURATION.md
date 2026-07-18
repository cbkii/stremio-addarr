# Configuration reference

Use this guide for server settings and manual `.env` changes. For the browser/TV dashboard itself, see [CONFIGURATION_UI.md](CONFIGURATION_UI.md). For public HTTPS, see [../README_HOST.md](../README_HOST.md).

The active systemd installation normally reads:

```text
/opt/stremio-addarr/.env
```

## Recommended method

Run the installer or upgrade script, then use the protected Configure URL it prints:

```text
https://YOUR_HOSTNAME/YOUR_ADDON_ACCESS_TOKEN/configure
```

Saving from the UI updates `.env` safely. Restart the service when prompted:

```bash
sudo systemctl restart stremio-addarr
sudo systemctl status stremio-addarr --no-pager -l
```

## Token roles

| Setting | Purpose |
|---|---|
| `ADDON_ACCESS_TOKEN` | Forms the private Stremio path: `/<token>/manifest.json` and `/<token>/configure`. Changing it requires reinstalling the add-on in Stremio. |
| `CONFIG_UI_TOKEN` | Entered inside the Configure page to unlock server settings. It is not part of the manifest URL. |

New installer-generated values are eight URL-safe characters. Valid longer existing values remain supported.

## Core settings

| Setting | Typical value | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Keeps Node local to the host. Caddy supplies public access. |
| `PORT` | `7010` | Local service port. |
| `PUBLIC_BASE_URL` | `https://example.duckdns.org` | Exact public HTTPS origin, without a trailing path. |
| `TARGET_CLIENT` | `android-tv` | Enables Android TV compatibility checks. |
| `TZ` | `Australia/Sydney` | Timezone used for displayed dates and scheduled work. |
| `MANIFEST_LOGO_URL` | `local` | Serves the bundled logo. Use `none` to omit it or an explicit HTTPS URL for external hosting. |
| `LOG_LEVEL` | `info` | Use `debug` only while troubleshooting. |

Do not use nested values such as `MANIFEST_LOGO_URL=https://${PUBLIC_BASE_URL}/...`; systemd `EnvironmentFile=` does not expand shell variables.

## Radarr

| Setting | Purpose |
|---|---|
| `RADARR_ENABLED` | Enables movie status, add and search actions. |
| `RADARR_BASE_URL` | URL used by this server to reach Radarr. |
| `RADARR_CARD_URL` | Optional user-facing URL shown on tiles. |
| `RADARR_API_KEY` | Radarr API key. |
| `RADARR_ROOT_FOLDER_PATH` | Root folder used for newly added movies. |
| `RADARR_QUALITY_PROFILE_ID` | Quality profile applied to new movies. |
| `RADARR_MINIMUM_AVAILABILITY` | Earliest release state Radarr may consider available. |
| `RADARR_TAGS` | Optional comma-separated numeric tag IDs, for example `1,3`. |
| `RADARR_SEARCH_ON_ADD` | Starts a search immediately after adding. |
| `RADARR_STRICT_IMDB_MATCH` | Requires a strict IMDb match before acting on an existing movie. |

Find root folders, quality profiles and tags through Radarr or the Configure page's **Test & discover options** action.

## Sonarr

| Setting | Purpose |
|---|---|
| `SONARR_ENABLED` | Enables series/episode status, add, search and monitoring actions. |
| `SONARR_BASE_URL` | URL used by this server to reach Sonarr. |
| `SONARR_CARD_URL` | Optional user-facing URL shown on tiles. |
| `SONARR_API_KEY` | Sonarr API key. |
| `SONARR_ROOT_FOLDER_PATH` | Root folder used for newly added series. |
| `SONARR_QUALITY_PROFILE_ID` | Quality profile applied to new series. |
| `SONARR_LANGUAGE_PROFILE_ID` | Sonarr v3 only. Leave unused for Sonarr v4. |
| `SONARR_TAGS` | Optional comma-separated numeric tag IDs. |
| `SONARR_SEARCH_ON_ADD` | Starts a search immediately after adding. |

### Monitoring modes

`SONARR_SERIES_MONITOR` accepts Sonarr modes such as `all`, `future`, `missing`, `existing`, `firstSeason`, `lastSeason`, `latestSeason`, `pilot`, `recent`, `none` and `skip`, plus these episode-scoped modes:

| Value | Behaviour |
|---|---|
| `ep` | Monitor only the selected episode. |
| `epfuture` | Monitor the selected episode and future episodes. |
| `epseason` | Monitor the selected episode through the end of its season. |

`SONARR_MONITOR_NEW_ITEMS` accepts:

- `auto` — follows the selected monitoring mode;
- `all` — future items remain monitored;
- `none` — future items remain unmonitored.

The action tile summarises this compactly. Examples:

```text
📡: this ❌new
📡: +future ✅new
📡: this (⥸3 / ⎗8 = +future) ❌new→✅new
```

For `ep` auto-upgrade behaviour:

- `EP_COUNT` is the number of downloaded prior episodes required to upgrade the scope;
- `EP_COUNT_PAST` is the prior-episode window inspected;
- `EP_COUNT_MOD` is the resulting scope: `epfuture` or `epseason`;
- `EP_COUNT <= 1` disables auto-upgrade.

## Catalogues and caching

| Setting | Default | Purpose |
|---|---:|---|
| `CATALOG_PAGE_SIZE` | `30` | Cards returned per request; accepted range is 10–100. |
| `RADARR_CATALOG_WATCHED_KEEP_COUNT` | `1` | Watched movies retained in filtered Radarr views. Use `0` to hide them. |
| `CATALOG_CACHE_TTL_MS` | `5000` | Short in-memory Arr catalogue cache. |
| `CATALOG_CACHE_MAX_AGE_SEC` | `15` | Fresh response cache hint sent to Stremio. |
| `CATALOG_STALE_REVALIDATE_SEC` | `60` | Stale-while-revalidate window. |
| `CATALOG_STALE_ERROR_SEC` | `120` | Stale-if-error window. |

The manifest advertises matching `skip` steps, so Stremio pagination follows the configured page size.

## Playback

| Setting | Purpose |
|---|---|
| `KODI_ENABLED` | Enables Kodi fallback actions. |
| `KODI_PACKAGE` | Kodi Android package, normally `org.xbmc.kodi`. |
| `FILE_STREAMING_ENABLED` | Enables direct media-file streaming from this host. |
| `FILE_STREAMING_SECRET` | Signing secret required before direct streaming can be enabled. Configure it outside the UI. |
| `FILE_STREAMING_PLAYBACK_MODE` | `direct` or `kodi`. |

Media paths must resolve beneath the configured Radarr/Sonarr root folders from the add-on's filesystem namespace.

## Trakt and TMDB

For watched sync, follow [TRAKT.md](TRAKT.md).

TMDB is an optional release-date fallback:

| Setting | Purpose |
|---|---|
| `TMDB_API_READ_ACCESS_TOKEN` | TMDB read-access token. |
| `TMDB_API_BASE_URL` | Normally `https://api.themoviedb.org`. |
| `TMDB_RELEASE_REGION` | Two-letter release region, for example `AU`. |

## Manual editing

Back up and edit the environment file:

```bash
sudo cp -a /opt/stremio-addarr/.env \
  "/opt/stremio-addarr/.env.backup-$(date +%Y%m%d-%H%M%S)"

sudo nano /opt/stremio-addarr/.env
sudo systemctl restart stremio-addarr
```

Verify the result:

```bash
systemctl is-active stremio-addarr
curl -fsS http://127.0.0.1:7010/healthz | python3 -m json.tool
curl -fsS http://127.0.0.1:7010/status.json | python3 -m json.tool
```

The complete variable list and defaults remain in [../.env.example](../.env.example). Avoid duplicating `.env` keys in multiple guides; treat that file as the exhaustive reference.
