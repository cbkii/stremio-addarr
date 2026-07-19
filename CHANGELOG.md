# Changelog

## Unreleased

### Fixed

- Replace the broken pasted-code Trakt setup and universal OOB assumption with Trakt Device Code Flow, exact interval/expiry polling, bounded retries and a standalone `bash quick.sh trakt` repair mode.
- Preserve existing registered Trakt redirect values, while deriving a beginner-friendly `<PUBLIC_BASE_URL>/trakt/callback` suggestion for new DuckDNS/Caddy installations without requiring a callback route.
- Prevent stale persisted Trakt state from overriding newly authorised credentials after restart.
- Use provider token expiry metadata, proactive refresh, `Retry-After`, required Trakt headers and atomic `0600` token-state persistence.
- Serve the configuration UI at both `/configure` and the Stremio-derived `/<ADDON_ACCESS_TOKEN>/configure` path.
- Correct `quick.sh` verification and final output to use the protected manifest URL instead of the obsolete `/manifest.json` route.
- Correct the release-note verification checklist to use `/healthz`, `/status.json`, the protected manifest path and the token-derived Configure path.
- Stop the upgrade merge from treating commented `.env` examples as configured values, which could preserve placeholder tokens and prevent startup.
- Require the service to remain active across consecutive checks before an install or upgrade is reported healthy.
- Migrate nested `MANIFEST_LOGO_URL=${PUBLIC_BASE_URL}...` values to `MANIFEST_LOGO_URL=local`, because systemd `EnvironmentFile=` does not perform shell expansion.
- Add the token-derived Configure compatibility rewrite to every Caddy example and the hosting guide.

### Changed

- Remove unsupported Trakt website scraping; release-date fallback now uses documented Trakt API methods only when a Client ID is configured.
- Add an interactive token wizard to `quick.sh`: keep an existing token, specify an 8-character value, or generate a random 8-character value.
- Retain support for longer legacy tokens while making short TV-friendly tokens the default for new installations.
- Restore configurable catalogue page sizes from 10 to 100 with a Pi-friendly default of 30.
- Redesign the configuration UI for compact TV and landscape use, with smaller header/status/actions, purple action controls, wider responsive layouts and detailed field guidance.
- Rework D-pad behaviour so form navigation is sequential, number inputs can be exited, tabs are predictable, Back first leaves edit mode, and the sticky save action is reached only at the end.
- Replace all Configure UI checkboxes with explicit Enabled/Disabled dropdowns for reliable Android TV remote operation.
- Clarify that saving changes server configuration, while Install / reinstall is only for initial installation or access-token rotation.
- Refocus `README.md` on concise end-user installation, upgrade and operation, with configuration, troubleshooting, Trakt and contributor material moved to dedicated cross-linked guides.
- Shorten Sonarr scope tile labels, remove middle-dot separators and display episode auto-upgrade thresholds as `(⥸count / ⎗window = target)`.
