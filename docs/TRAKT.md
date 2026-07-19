# Trakt watched sync

Trakt watched sync is optional. It lets `stremio-addarr` identify watched movies and episodes without relying on Stremio account sessions.

For general server settings, see [CONFIGURATION.md](CONFIGURATION.md). For public DuckDNS/Caddy hosting, see [../README_HOST.md](../README_HOST.md). For failures, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Beginner setup: DuckDNS and Caddy

Most users should use the same trusted HTTPS hostname already configured as `PUBLIC_BASE_URL`.

Example:

```dotenv
PUBLIC_BASE_URL=https://myaddarr.duckdns.org
TRAKT_REDIRECT_URI=https://myaddarr.duckdns.org/trakt/callback
```

This is compatible with the normal DuckDNS/Caddy setup because it reuses the hostname and TLS certificate you already configured.

Important:

- Device Code Flow does **not** browse to or call `/trakt/callback`.
- You do **not** need to add a Caddy route, rewrite, handler or reverse-proxy exception for that path.
- The redirect URI is retained as an exact registered OAuth application value for refresh-token validation.
- Existing registered values remain supported. If your existing Trakt application uses `urn:ietf:wg:oauth:2.0:oob`, keep that exact value instead of replacing it merely because the HTTPS example looks newer.

`bash quick.sh trakt` reads `PUBLIC_BASE_URL` and automatically suggests:

```text
<PUBLIC_BASE_URL>/trakt/callback
```

Press **Enter** to accept the suggestion only after entering that same exact value in the Trakt application.

## Create the Trakt application

1. Open <https://trakt.tv/oauth/applications>.
2. Create a new application, or open the application already used by `stremio-addarr`.
3. Use a clear name such as `stremio-addarr`.
4. Set **Redirect URI**:
   - new DuckDNS/Caddy setup: `https://YOUR_SUBDOMAIN.duckdns.org/trakt/callback`;
   - existing application: keep its currently registered redirect URI exactly, including case.
5. If Trakt asks for a website URL, use `PUBLIC_BASE_URL`, for example `https://YOUR_SUBDOMAIN.duckdns.org`.
6. Save the application.
7. Copy the **Client ID** and **Client Secret**.

The helper explains these steps again and displays the exact suggestion derived from your installed `.env`.

## Connect or repair Trakt

Download the current helper when necessary:

```bash
gh release download --repo cbkii/stremio-addarr \
  --pattern quick.sh \
  --output quick.sh \
  --clobber
chmod +x quick.sh
```

Run only the Trakt setup/repair flow:

```bash
bash quick.sh trakt
```

For a normal install or upgrade, accept the optional Trakt prompt from:

```bash
bash quick.sh install
# or
bash quick.sh upgrade
```

The helper:

1. reads `/opt/stremio-addarr/.env`;
2. preserves an existing registered redirect URI;
3. otherwise derives a DuckDNS/Caddy-friendly suggestion from `PUBLIC_BASE_URL`;
4. gives exact beginner application-creation instructions;
5. asks for the Client ID and Client Secret;
6. requests a short Device Code from Trakt;
7. prints a direct activation URL such as `https://trakt.tv/activate/ABCD1234`;
8. polls only at Trakt's returned interval and stops at its returned expiry;
9. validates refresh-token rotation using the exact registered redirect URI;
10. verifies the authorised account through `/users/settings`;
11. stores tokens and provider expiry metadata atomically;
12. clears stale runtime token state and restarts the service.

Full access and refresh tokens are never printed after receipt.

## What to enter at each prompt

| Prompt | Beginner value |
|---|---|
| Client ID | Copy from the saved Trakt application. |
| Client Secret | Copy from the same application. Input is visible in the terminal. |
| Redirect URI | Press Enter for the suggested DuckDNS value after registering it, or keep the existing registered value exactly. |
| Trakt API URL | Press Enter to keep `https://api.trakt.tv`. Change this only for an intentional advanced setup. |

After the device code appears, open the displayed activation URL on a phone or computer, sign in to Trakt and approve access. The terminal continues automatically.

## Existing OOB applications

The previous bug was silently assuming that every user had registered:

```dotenv
TRAKT_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
```

The URN itself is not rejected by `stremio-addarr`. It remains compatible when it is the exact redirect URI registered in your Trakt application.

The corrected behaviour is:

- preserve any existing configured value;
- never silently replace it;
- suggest the DuckDNS/Caddy HTTPS value only for a new setup with no redirect configured;
- require the submitted value to match the Trakt application exactly for refresh validation.

## Retry and recovery

A failed attempt does not enable incomplete credentials. The helper offers:

- retry refresh validation;
- edit the Client Secret or redirect URI;
- request a new device code;
- edit all application credentials;
- skip Trakt without aborting the rest of an install or upgrade.

Common results:

| Result | Meaning | Action |
|---|---|---|
| HTTP 400 while polling | approval is pending | wait; polling continues |
| HTTP 429 | rate limit or slow-down | the helper honours `Retry-After` |
| temporary 5xx | Trakt service problem | retried up to three consecutive times |
| HTTP 404 | invalid device code | request a new code and verify the Client ID |
| HTTP 409 | device code already used | request a new code |
| HTTP 410 | device code expired | request a new code |
| HTTP 418 | approval denied | request a new code when ready |
| refresh HTTP 400/401 | secret, redirect URI or refresh token mismatch | edit values or re-authorise |
| `trakt_reauthorization_required` | stored refresh credentials were rejected | run `bash quick.sh trakt` |

A refresh error does not mean Caddy needs a callback route. First compare the redirect URI in `/opt/stremio-addarr/.env` with the Trakt application character-for-character.

## Stored settings

A successful flow writes:

```dotenv
TRAKT_SYNC_ENABLED=true
TRAKT_SYNC_MINS=360
TRAKT_API_BASE_URL=https://api.trakt.tv
TRAKT_CLIENT_ID=...
TRAKT_CLIENT_SECRET=...
TRAKT_REDIRECT_URI=https://myaddarr.duckdns.org/trakt/callback
TRAKT_REFRESH_TOKEN=...
TRAKT_ACCESS_TOKEN=...
TRAKT_ACCESS_TOKEN_CREATED_AT=...
TRAKT_ACCESS_TOKEN_EXPIRES_IN=...
TRAKT_AUTH_GENERATION=...
```

`TRAKT_AUTH_GENERATION` prevents an older runtime state file from overriding newly authorised credentials. Runtime refresh-token rotation remains in the state file with mode `0600`.

## Runtime behaviour

- Trakt's `created_at` and `expires_in` values determine token lifetime.
- Access tokens refresh before expiry.
- Refresh and API requests retry bounded transient failures and honour `Retry-After`.
- Concurrent 401 responses share one refresh operation.
- Rotated tokens are persisted atomically.
- Temporary Trakt failure does not block Radarr or Sonarr actions.
- `TRAKT_SYNC_MINS` must be at least 40 minutes.
- Release-date lookup uses documented Trakt API methods; website scraping is not used.

## Verify watched sync

```bash
curl -fsS http://127.0.0.1:7010/status.json | jq '.watched'
```

Trigger a local sync and recheck:

```bash
curl -fsS -X POST http://127.0.0.1:7010/trakt/sync
curl -fsS http://127.0.0.1:7010/status.json | jq '.watched'
```

Inspect recent logs:

```bash
sudo journalctl -u stremio-addarr -n 300 --no-pager -o cat \
  | jq 'select(.message | tostring | test("trakt|watched"; "i"))'
```

## Disable sync

Set:

```dotenv
TRAKT_SYNC_ENABLED=false
```

Then restart:

```bash
sudo systemctl restart stremio-addarr
```

Disabling sync does not change Trakt account data.

## Official references

- [Trakt authentication](https://docs.trakt.tv/reference/authentication)
- [Generate device codes](https://docs.trakt.tv/reference/postoauthdevicecode)
- [Poll for a device token](https://docs.trakt.tv/reference/postoauthdevicetoken)
- [Exchange or refresh a token](https://docs.trakt.tv/reference/postoauthtoken)
- [Required API headers](https://docs.trakt.tv/docs/required-headers)
- [Rate limits and Retry-After](https://docs.trakt.tv/docs/rate-limiting)
