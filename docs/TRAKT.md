# Trakt watched sync

Trakt watched sync is optional. It lets the add-on identify watched movies and episodes without relying on Stremio account sessions.

For general server settings, see [CONFIGURATION.md](CONFIGURATION.md). For failures, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Current authentication model

`stremio-addarr` uses Trakt's **Device Code Flow**, which Trakt recommends for command-line scripts and system services.

The previous out-of-band browser-code flow is no longer used. You do not paste an authorisation code into `quick.sh`.

Official references:

- [Trakt authentication](https://docs.trakt.tv/reference/authentication)
- [Generate device codes](https://docs.trakt.tv/reference/postoauthdevicecode)
- [Poll for a device token](https://docs.trakt.tv/reference/postoauthdevicetoken)
- [Exchange or refresh a token](https://docs.trakt.tv/reference/postoauthtoken)
- [Required API headers](https://docs.trakt.tv/docs/required-headers)
- [Rate limits and Retry-After](https://docs.trakt.tv/docs/rate-limiting)

## Create or check the Trakt application

Open:

```text
https://trakt.tv/oauth/applications
```

The application must provide:

- a Client ID;
- a Client Secret;
- a redirect URI.

The redirect URI is case-sensitive. It must exactly match the value saved as `TRAKT_REDIRECT_URI`. Device activation itself does not redirect to this URI, but Trakt requires it later when the refresh token is exchanged.

## Recommended setup or repair

For a normal install or upgrade, accept the Trakt prompt:

```bash
bash quick.sh install
# or
bash quick.sh upgrade
```

To repair only Trakt without reinstalling or upgrading the add-on:

```bash
gh release download --repo cbkii/stremio-addarr --pattern quick.sh --output quick.sh --clobber
chmod +x quick.sh
bash quick.sh trakt
```

The script:

1. reads the existing Trakt settings from `/opt/stremio-addarr/.env`;
2. requests a short device code from Trakt;
3. prints a direct activation URL such as `https://trakt.tv/activate/ABCD1234`;
4. polls at Trakt's returned interval and stops at the returned expiry;
5. handles pending, slow-down, invalid, already-used, expired and denied responses;
6. validates refresh-token rotation using the exact configured redirect URI;
7. verifies the resulting bearer token against `/users/settings`;
8. writes the access token, refresh token and provider expiry metadata atomically;
9. creates a new authentication-generation marker and discards stale runtime token state;
10. restarts the service when run through `quick.sh`.

No full token is printed after it is received.

## Retry and recovery choices

A failed attempt does not silently enable broken credentials.

The interactive flow offers:

- request a new device code;
- edit the Client ID, Client Secret or redirect URI;
- retry refresh validation;
- abandon Trakt setup without aborting the rest of an install or upgrade.

Common results:

| Result | Meaning | Action |
|---|---|---|
| HTTP 400 while polling | approval is still pending | wait; the script continues |
| HTTP 429 | polling or API rate limit | the script honours `Retry-After` and slows down |
| HTTP 404 | invalid device code | request a new code and verify the Client ID |
| HTTP 409 | device code already consumed | request a new code |
| HTTP 410 | device code expired | request a new code |
| HTTP 418 | approval was denied | request a new code when ready |
| refresh HTTP 400/401 | secret, redirect URI or refresh token is invalid | edit the values or re-authorise |
| `trakt_reauthorization_required` | Trakt rejected the stored refresh credentials | run `bash quick.sh trakt` |

## Stored settings

A successful device flow writes:

```dotenv
TRAKT_SYNC_ENABLED=true
TRAKT_SYNC_MINS=360
TRAKT_API_BASE_URL=https://api.trakt.tv
TRAKT_CLIENT_ID=...
TRAKT_CLIENT_SECRET=...
TRAKT_REDIRECT_URI=https://exact-value-from-your-trakt-app.example/callback
TRAKT_REFRESH_TOKEN=...
TRAKT_ACCESS_TOKEN=...
TRAKT_ACCESS_TOKEN_CREATED_AT=...
TRAKT_ACCESS_TOKEN_EXPIRES_IN=...
TRAKT_AUTH_GENERATION=...
```

`TRAKT_AUTH_GENERATION` prevents an older `TRAKT_SYNC_STATE_FILE` from overriding newly authorised credentials after restart. Runtime refresh-token rotation remains in the state file with mode `0600`.

## Runtime behaviour

- Provider `created_at` and `expires_in` values determine token lifetime.
- Access tokens are refreshed before expiry rather than using a hard-coded lifetime.
- Refresh and API requests retry bounded transient failures and honour `Retry-After`.
- Concurrent 401 responses share one refresh operation.
- Rotated refresh tokens are persisted atomically in a private state file.
- A temporary Trakt failure does not block Radarr or Sonarr actions.
- `TRAKT_SYNC_MINS` must be at least 40 minutes.
- Release-date lookup uses the documented Trakt API only when a Client ID is configured; website scraping is deliberately not used.

## Check sync status

```bash
curl -fsS http://127.0.0.1:7010/status.json | jq '.watched'
```

Trigger a local sync and recheck:

```bash
curl -fsS -X POST http://127.0.0.1:7010/trakt/sync
curl -fsS http://127.0.0.1:7010/status.json | jq '.watched'
```

Inspect recent Trakt logs:

```bash
sudo journalctl -u stremio-addarr -n 300 --no-pager -o cat \
  | jq 'select(.message | tostring | test("trakt|watched"; "i"))'
```

## Manual device-flow outline

The supported helper is recommended because it implements polling intervals, expiry, retries, secure storage and refresh validation. For diagnostics, the protocol is:

```bash
curl -fsS -X POST 'https://api.trakt.tv/oauth/device/code' \
  -H 'Content-Type: application/json' \
  -H 'trakt-api-version: 2' \
  -H 'trakt-api-key: YOUR_CLIENT_ID' \
  -H 'User-Agent: stremio-addarr/manual' \
  -d '{"client_id":"YOUR_CLIENT_ID"}' | jq .
```

Display the returned `user_code` and `verification_url`, then poll `/oauth/device/token` using the returned `device_code`, `interval` and `expires_in`. Do not poll faster than `interval`; handle HTTP 429 using `Retry-After`.

## Disable sync

Set:

```dotenv
TRAKT_SYNC_ENABLED=false
```

Then restart:

```bash
sudo systemctl restart stremio-addarr
```

Disabling sync does not alter Trakt account data. Remove local credentials separately only when the server should no longer retain them.
