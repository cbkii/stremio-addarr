# Trakt watched sync

Trakt watched sync is optional. It lets the add-on hide or identify watched items without relying on Stremio account sessions.

For general server settings, see [CONFIGURATION.md](CONFIGURATION.md). For failures, see [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## Recommended setup

Run install or upgrade:

```bash
bash quick.sh install
# or
bash quick.sh upgrade
```

When prompted:

1. Choose **yes** for Trakt watched-sync OAuth.
2. Open the printed Trakt authorisation URL.
3. Approve access.
4. Paste the returned code into the terminal.

The script writes the required values and enables sync:

```dotenv
TRAKT_SYNC_ENABLED=true
TRAKT_SYNC_MINS=360
```

It also stores the client ID, client secret and refresh token without printing them again.

Restart and verify:

```bash
sudo systemctl restart stremio-addarr
curl -fsS http://127.0.0.1:7010/status.json | python3 -m json.tool
```

## Manual setup

Create a Trakt API application and obtain:

- client ID;
- client secret;
- authorisation code.

Use this redirect URI unless your Trakt application was configured differently:

```text
urn:ietf:wg:oauth:2.0:oob
```

Open:

```text
https://trakt.tv/oauth/authorize?response_type=code&client_id=YOUR_CLIENT_ID&redirect_uri=urn%3Aietf%3Awg%3Aoauth%3A2.0%3Aoob
```

Exchange the returned code:

```bash
curl -fsS -X POST 'https://api.trakt.tv/oauth/token' \
  -H 'Content-Type: application/json' \
  -d '{
    "code": "PASTE_AUTHORIZATION_CODE",
    "client_id": "YOUR_CLIENT_ID",
    "client_secret": "YOUR_CLIENT_SECRET",
    "redirect_uri": "urn:ietf:wg:oauth:2.0:oob",
    "grant_type": "authorization_code"
  }' | python3 -m json.tool
```

Copy the returned `refresh_token` into `/opt/stremio-addarr/.env`:

```dotenv
TRAKT_SYNC_ENABLED=true
TRAKT_SYNC_MINS=360
TRAKT_API_BASE_URL=https://api.trakt.tv
TRAKT_CLIENT_ID=YOUR_CLIENT_ID
TRAKT_CLIENT_SECRET=YOUR_CLIENT_SECRET
TRAKT_REFRESH_TOKEN=YOUR_REFRESH_TOKEN
TRAKT_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
```

Restart:

```bash
sudo systemctl restart stremio-addarr
```

## Behaviour

- Sync is interval-gated and persisted across restarts.
- Refresh-token rotation is persisted by the add-on.
- A temporary Trakt failure does not block Radarr/Sonarr actions.
- `TRAKT_SYNC_MINS` has a minimum effective interval of 40 minutes.
- Release-date lookup uses Arr metadata first, Trakt second and optional TMDB fallback last.

## Check sync status

```bash
curl -fsS http://127.0.0.1:7010/status.json \
  | jq '.watched'
```

Inspect recent sync errors:

```bash
sudo journalctl -u stremio-addarr -n 300 --no-pager -o cat \
  | jq 'select(.message | tostring | test("Trakt|watched"; "i"))'
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

Disabling sync does not delete your Trakt account data. Remove local credentials from `.env` separately only when you no longer want the server to retain them.
