# AGENTS.md

This repository is the starter scaffold for the **Arr Status & Add** Stremio add-on.

## Mission

Build a **self-hosted LAN-first Stremio add-on** that:
- shows whether the current movie or episode is already present in Radarr or Sonarr
- distinguishes **added** vs **downloaded** where the Arr APIs make that practical
- lets the user trigger **Add + Search** from a supported Stremio add-on action surface
- stays fast and readable on **Android TV v9 + Stremio 1.9+**

## Non-negotiables

- Keep the design **LAN-first**. Do not assume Radarr or Sonarr are publicly reachable.
- Keep secrets **server-side**. Do not move Arr API keys into manifest URLs, config URLs, or visible labels.
- Use only **supported Stremio add-on protocol surfaces**. Do not claim the addon can inject an undocumented native button beside Stremio's own “Add to library”.
- Prefer **small payloads**, **deterministic ordering**, and **one strong action** over crowded UI.
- Never add piracy source scraping, mirror discovery, anti-bot bypassing, or unauthorised stream sources.

## Primary architecture

- Language: TypeScript
- Runtime: Node.js 20+
- Host: self-hosted Express app on LAN
- Add-on SDK: official `stremio-addon-sdk`
- Primary Stremio surface: `stream`
- Optional later surface: `meta.links`
- Config model: `.env` on the server, not user secrets encoded into the addon install URL

## Product rules

### Movie pages
Return a small Arr tile set such as:
- `Radarr • Downloaded`
- `Radarr • Added`
- `Radarr • Missing`
- `Add to Radarr + Search`

### Episode pages
Treat the UI as episode-aware, but keep backend add semantics series-level where needed.
Examples:
- `Sonarr • Episode Downloaded`
- `Sonarr • Episode Missing`
- `Sonarr • Series Added`
- `Add to Sonarr + Search`

## Engineering rules

- Use native `fetch` on modern Node.
- Set explicit timeouts for every Arr request.
- Cache list/status calls briefly.
- Fail soft: if Arr is unreachable, return a simple status stream instead of throwing raw errors.
- Keep logs structured and never print API keys.
- Validate all env values and malformed IDs.
- Keep HTML result pages minimal and readable on TV browsers.

## Reference constraints

Stremio add-ons expose `/manifest.json` and routes such as `/{resource}/{type}/{id}.json`; documented resources are `catalog`, `meta`, `stream`, and `subtitles`. Configurable add-ons can expose `/configure`, and Stremio supports deep links including detail pages. The official SDK also includes TypeScript support. citeturn0search0turn0search4turn0search5turn4search0turn5search0

Radarr and Sonarr both expose official API docs that cover movie lookup / add and series lookup / add flows, which should be treated as the source of truth for request shapes while finishing this starter. citeturn1search0turn1search1

## Expected future work

1. Harden Radarr add payload handling.
2. Finish Sonarr series lookup by IMDb and fallback matching.
3. Add proper downloaded / monitored / missing state mapping.
4. Add optional confirm-before-add flow.
5. Add tests around duplicate detection, episode status, and Arr outage handling.
6. Add optional TMDB fallback only if lookup quality needs it.

## Review checklist

Every meaningful change should include:
- what user-visible Stremio behaviour changed
- what Arr endpoint assumptions were introduced or removed
- how to verify locally on LAN
- how Android TV UX is affected
