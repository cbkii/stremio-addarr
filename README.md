# stremio-addarr

Self-hosted Stremio add-on scaffold for **Arr Status & Add**.

This starter is designed for a LAN-accessible setup where **Stremio**, **Radarr**, and **Sonarr** can already reach each other on your home network. It focuses on the first supported Stremio interaction model that fits the product goal:

- show **Arr status** for the current movie or episode through the `stream` resource
- expose one clear action to **add + search** in Radarr or Sonarr
- keep the server **self-hosted**, because your Arr apps are on LAN and should not be exposed through a public cloud host

## What is included

- minimal **TypeScript** Node project
- official **`stremio-addon-sdk`** integration
- Express host with:
  - `/manifest.json`
  - `/stream/:type/:id.json`
  - `/health`
  - `/action/...` side-effect routes for Arr adds
  - `/` landing page with install URL and setup hints
- Radarr and Sonarr client modules with the main request / status / add flow scaffolded
- small TTL cache to avoid hammering Arr on Android TV browsing
- AGENTS.md for future codegen / agent work

## Current implementation state

This is **initial scaffolding**, not the finished production add-on.

Already scaffolded:
- manifest and stream handler shape
- Stremio ID parsing for movie vs episode pages
- LAN-first config model using environment variables instead of putting secrets into addon URLs
- Radarr / Sonarr HTTP clients
- basic status tiles
- add-action endpoint shell with HTML result page

Still to finish:
- richer status mapping and badges
- stronger Sonarr lookup fallback paths
- optional TMDB fallback resolution
- finer duplicate detection and retry handling
- optional confirm-before-add flow
- polishing Android TV wording and iconography

## Why this shape

Stremio’s official protocol is resource-based and add-ons expose `/manifest.json` plus resource routes such as `/{resource}/{type}/{id}.json`. The official SDK supports Node add-ons, typed handlers, and Express router integration. Stremio also supports clickable `externalUrl` stream entries and configurable add-ons, but passing secrets through addon URLs is not a good fit for a LAN-only Arr deployment. citeturn0search0turn0search4turn4search0turn4search3turn5search0

For this starter, the safest initial model is a **single-user self-hosted add-on** with secrets stored server-side in `.env`, not inside the Stremio install URL. That keeps the architecture small and suits a private home setup.

## Requirements

- Node.js 20+
- npm 10+
- Radarr on your LAN
- Sonarr on your LAN
- Stremio able to reach the add-on host

## Quick start

```bash
cd /data/data/com.termux/files/home/repos/stremio-addarr
cp .env.example .env
# edit .env with your LAN URLs, API keys, and root/profile IDs
npm install
npm run dev
```

If you are installing from another device, put the add-on behind HTTPS first and then set `PUBLIC_BASE_URL` accordingly.

Open during local development:

- landing page: `http://127.0.0.1:7010/`
- health: `http://127.0.0.1:7010/health`
- manifest: `http://127.0.0.1:7010/manifest.json`

For installation from another device, set `PUBLIC_BASE_URL` to an HTTPS URL that the Stremio client can reach, then use that HTTPS manifest URL. The official SDK docs note that add-on URLs must be loaded over HTTPS except for `127.0.0.1`, and must support CORS. citeturn4search2


## HTTPS on LAN is important

If the Stremio client is not running on the same host as the add-on, do **not** assume `http://192.168.x.x:7010/manifest.json` will install cleanly. The official SDK docs say add-on URLs must use **HTTPS**, except for `127.0.0.1`. citeturn4search2

For a private LAN deployment, the usual pattern is:

- Node app on `127.0.0.1:7010` or `0.0.0.0:7010`
- local reverse proxy such as **Caddy**
- `PUBLIC_BASE_URL` set to your HTTPS hostname

A starter `Caddyfile.example` is included.

## Termux unzip + setup commands

Assuming the zip is downloaded into your home directory as `~/stremio-addarr.zip`:

```bash
pkg update
pkg install -y git gh unzip nodejs-lts
mkdir -p /data/data/com.termux/files/home/repos/stremio-addarr
unzip -q ~/stremio-addarr.zip -d /data/data/com.termux/files/home/repos/stremio-addarr
cd /data/data/com.termux/files/home/repos/stremio-addarr
cp .env.example .env
nano .env
npm install
npm run dev
```

If you are installing from another device, put the add-on behind HTTPS first and then set `PUBLIC_BASE_URL` accordingly.

If the zip contains a top-level folder and you want a flat repo directory instead:

```bash
tmpdir="$(mktemp -d)"
unzip -q ~/stremio-addarr.zip -d "$tmpdir"
mkdir -p /data/data/com.termux/files/home/repos/stremio-addarr
cp -a "$tmpdir"/*/. /data/data/com.termux/files/home/repos/stremio-addarr/ 2>/dev/null || true
cp -a "$tmpdir"/* /data/data/com.termux/files/home/repos/stremio-addarr/ 2>/dev/null || true
rm -rf "$tmpdir"
cd /data/data/com.termux/files/home/repos/stremio-addarr
```

## GitHub repo creation commands

```bash
cd /data/data/com.termux/files/home/repos/stremio-addarr
git init -b main
git add .
git commit -m "Initial Arr Status & Add scaffold"
gh auth login
gh repo create cbkii/stremio-addarr --source=. --private --remote=origin --push
```

For a public repo, replace `--private` with `--public`.

## Suggested first development steps

1. Fill in `.env` with real Arr values.
2. Validate that `/health` shows both Arr apps configured.
3. Install the add-on in Stremio from the LAN manifest URL.
4. Confirm that a movie page shows an Arr stream tile.
5. Finish Radarr add flow, then Sonarr episode-aware status flow.
6. Add tests around ID parsing, duplicate detection, and Arr failure handling.

## Status model planned for v1

### Movies
- Not in Radarr
- Added to Radarr
- Downloaded in Radarr
- Missing in Radarr
- Action: `Add to Radarr + Search`

### Episodes / series
- Series not in Sonarr
- Series added to Sonarr
- Episode monitored
- Episode downloaded
- Episode missing
- Action: `Add to Sonarr + Search`

## Notes on Stremio behaviour

Stremio’s documented add-on resources are `catalog`, `meta`, `stream`, and `subtitles`. For this add-on, the main user action is best represented through the `stream` resource so the current item can show a small Arr action tile. Deep links such as `stremio:///detail/...` are also supported and can be used later on the post-action result page. citeturn0search0turn0search3turn5search0

## Development cautions

- Do not expose your Arr API keys in public URLs.
- Do not rely on cloud hosting for this LAN-only design.
- Treat Sonarr episode pages as **episode-aware for status**, but **series-level for add semantics**.
- Keep the tile labels short for Android TV.
- Cache status checks briefly to avoid repeated library scans while browsing. Android TV environments benefit from low-memory, low-latency flows. citeturn0search3turn0search5turn0search7
