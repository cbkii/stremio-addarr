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
- First-party LAN file playback (your own Arr-managed files) is allowed when authenticated and path-restricted.

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

## References and validation workflow

### Reference hierarchy (mandatory)
1. Official docs are the source of truth.
2. Battle-tested GitHub projects are implementation-pattern references only.
3. If any project example conflicts with official docs, follow official docs.
4. Every final report / PR summary / implementation note must clearly separate:
   - directly verified facts from official docs
   - inferred patterns from mature project examples
   - remaining assumptions, unknowns, or caveats

### Canonical references (source of truth)

#### Stremio
- Stremio Addon Protocol: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md
- Stremio SDK docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/README.md
- Stremio advanced docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/advanced.md
- Stremio API response docs (manifest): https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md
- Stremio API response docs (meta): https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/meta.md
- Stremio API response docs (stream): https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md
- Stremio guide (adding catalogs): https://stremio.github.io/stremio-addon-guide/sdk-guide/step2
- Stremio guide (catalog basics): https://stremio.github.io/stremio-addon-guide/step3
- Stremio guide (simple meta / metadata behaviour): https://stremio.github.io/stremio-addon-guide/step4
- Stremio deploying docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deploying/README.md
- Stremio deep links docs: https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/deep-links.md

#### Radarr / Sonarr
- Radarr API docs: https://radarr.video/docs/api/
- Sonarr API docs: https://sonarr.tv/docs/api/

#### Supplemental Arr verification helper
- Tsarr: https://github.com/robbeverhelst/Tsarr
- Use Tsarr only as a secondary endpoint/field sanity-check helper because it is generated from official OpenAPI specs; it does not replace official Radarr/Sonarr documentation.

### Mature project references (implementation-pattern references only)
- Stremio Jellyfin Addon: https://github.com/akarazniewicz/stremio-jellyfin
  - Useful for manifest shape and handler/module structure patterns.
- Jellio+: https://github.com/InfiniteAvenger/jellio-plus
  - Useful for personal library / personal catalog UX and metadata presentation patterns.
- Stremio-Seerr-Catalog: https://github.com/Aerya/Stremio-Seerr-Catalog
  - Useful for self-hosted deployment and request/response flow patterns.
- NexoTV: https://github.com/joaosavi/nexotv
  - Useful for configuration ergonomics, hosting layout, and polished add-on architecture patterns.

These projects are not API truth and must never override official docs.

### Required validation workflow for every meaningful change
Future agents must explicitly validate, as applicable to the change:
- manifest shape and compatibility with declared resources/types
- Stremio resource declarations and handler registration wiring
- catalog / meta / stream payload correctness
- extras and pagination semantics when relevant
- identifier strategy consistency across manifest, handlers, cache, and Arr mappings
- Radarr/Sonarr endpoint correctness (paths, methods, params, auth expectations)
- Radarr/Sonarr field assumptions (required fields, optional fields, nullability/default handling)
- docs/deployment instructions against actual code behavior
- reverse-proxy and hosted-manifest assumptions (especially LAN/self-hosted flows)
- release readiness and operational sanity (typecheck/tests/build, startup validation, safe failure behavior)

### Required reporting in final summaries / PR notes
Future agents should include:
- official docs checked
- reference projects inspected
- what was directly verified from official docs
- what was inferred from project examples
- remaining assumptions, caveats, or follow-up checks

## Review checklist
For each significant change include:
1. user-visible behavior change
2. Arr endpoint assumptions changed/unchanged
3. local verification steps
4. Android TV UX/performance impact
