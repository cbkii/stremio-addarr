# AGENTS.md

## Mission
Maintain **Arr Status & Add** as a production-ready, self-hosted, LAN-first Stremio add-on.

## Product contract
- Primary UX surface is Stremio `stream` resource.
- Show status first, and only one strong add action when not already present. Treat the UI as episode-aware, but keep backend add semantics series-level where needed.
- Movie pages map to Radarr status/add.
- Episode pages are episode-aware for status and series-level for Sonarr add semantics.
- Always fail softly with readable tiles/pages.

## Security rules
- Keep Arr credentials server-side (`.env`) only.
- Never expose API keys in URLs, labels, HTML pages, logs, or errors.
- Never add scraping/piracy/mirror/bypass features.
- First-party LAN file playback (your own Arr-managed files) is allowed when authenticated and path-restricted; do not add third-party scraping, bypass, or public mirror behavior.

## Engineering rules
- TypeScript, Node 20+, Express, `stremio-addon-sdk`.
- Use native `fetch` with explicit timeout.
- Keep dependencies small and justified.
- Short TTL cache for status-heavy lookups.
- Invalidate relevant cache entries after successful adds.
- Validate env configuration at startup with useful errors.
- Keep HTML pages minimal and TV-readable.

## Logging rules
- Structured JSON logs.
- Include route, method, duration, status.
- Redact sensitive fields by default.

## Deployment rules
- Design for Raspberry Pi/home-server LAN deployment.
- Raspberry Pi runs Sonarr and Radarr, while Android 9 TV runs Stremio, connectected via ethernet LAN.
- HTTPS reverse proxy guidance must remain accurate (Caddy example kept current).
- Do not assume private Arr services are publicly reachable.

## Testing rules
- Tests must not call real home LAN services.
- Mock Arr API responses.
- Keep tests deterministic and lightweight.

## CI/release rules
- CI must run typecheck, tests, and build.
- Tag `vX.Y.Z` should trigger release workflow and publish artifacts/checksums.

## Review checklist
For each significant change include:
1. user-visible behavior change
2. Arr endpoint assumptions changed/unchanged
3. local verification steps
4. Android TV UX/performance impact
