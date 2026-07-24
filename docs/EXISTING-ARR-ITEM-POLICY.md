# Existing Arr item policy and exact-search contract

## Purpose

`stremio-addarr` must distinguish between:

1. applying defaults to a **new** Radarr movie or Sonarr series; and
2. acting on an item that is **already configured** in Radarr or Sonarr.

The default behaviour for an existing item is to preserve the user's Arr configuration exactly while still carrying out the action represented by the clicked Stremio tile.

A click must therefore never become a no-op merely because monitoring or profile settings are preserved.

## Product contract

### Default behaviour

For an existing Radarr movie or Sonarr series:

- preserve its quality profile;
- preserve its monitored state;
- preserve Sonarr season and episode monitoring;
- preserve Sonarr `monitorNewItems`;
- preserve root folder, tags, minimum availability and other existing metadata;
- do not call Arr editor endpoints solely to make a search possible;
- always queue a targeted search for the exact movie or episode selected by the user.

For a newly added item:

- apply the configured `stremio-addarr` profile, root folder, tags and monitoring defaults;
- add the item once;
- resolve its exact Arr ID after creation;
- queue one targeted search for the selected movie or episode;
- avoid duplicate or unnecessarily broad searches.

## Configuration

Add independent policies because Radarr and Sonarr have different monitoring models:

```dotenv
RADARR_EXISTING_ITEM_POLICY=preserve
SONARR_EXISTING_ITEM_POLICY=preserve
```

Supported values:

| Value | Existing profile/settings | Existing monitoring | Search action |
|---|---|---|---|
| `preserve` | unchanged | unchanged | always target the clicked item |
| `extend` | unchanged | only add the minimum requested monitoring; never unmonitor anything | always target the clicked item |
| `apply-config` | apply configured settings | replace with configured monitoring scope | always target the clicked item |

`preserve` is the default when the setting is absent, including upgrades from older releases.

## Exact-search contract

A successful action means that Radarr or Sonarr accepted a targeted command for the exact resolved movie or episode. It does not guarantee that an indexer has a matching release or that a download will ultimately succeed.

### Radarr

For an existing movie:

1. resolve the current movie record using IMDb ID, then TMDB ID as fallback;
2. apply the selected existing-item policy;
3. send `POST /api/v3/command` with:

```json
{
  "name": "MoviesSearch",
  "movieIds": [123]
}
```

A manually invoked Radarr movie search can operate on an unmonitored movie. The add-on must not toggle `monitored=true` merely to execute the search.

### Sonarr

For an existing episode:

1. resolve the current series using IMDb ID, then TVDB ID as fallback;
2. resolve the exact episode using season and episode numbers;
3. apply the selected existing-item policy;
4. send `POST /api/v3/command` with:

```json
{
  "name": "EpisodeSearch",
  "episodeIds": [456]
}
```

A targeted Sonarr `EpisodeSearch` operates directly on supplied episode IDs. The default action must not unmonitor all episodes, alter season monitoring, or change `monitorNewItems` merely to search the clicked episode.

If the newly added series has not populated the selected episode yet, invalidate the episode cache and poll until the exact episode appears or the existing bounded readiness timeout expires. Do not silently replace the requested action with a whole-season or whole-series search.

## Policy semantics

### `preserve`

Existing item:

- no `/api/v3/movie/editor` request;
- no `/api/v3/series/editor` request;
- no `/api/v3/episode/monitor` request;
- no profile, root folder, tags, minimum availability or new-item policy update;
- queue the exact targeted search.

### `extend`

Existing Radarr movie:

- optionally monitor the clicked movie if required by the configured behaviour;
- preserve quality profile, root folder, tags and minimum availability.

Existing Sonarr episode:

- optionally monitor the selected episode and ensure the parent series is monitored;
- never unmonitor another episode or season;
- never change quality profile or `monitorNewItems`;
- queue the exact targeted episode search.

### `apply-config`

Existing item:

- explicitly apply the configured profile and monitoring policy;
- update only fields owned by the relevant `stremio-addarr` configuration;
- retain unrelated Arr metadata;
- queue the exact targeted search after the update.

The Configure UI must label this as destructive to existing Arr settings and require an intentional selection. It must never be the default.

## Existing-item recognition

Extend cached Arr resource types to retain the fields needed to recognise and display the actual state.

### Radarr movie fields

- `id`
- `imdbId`
- `tmdbId`
- `monitored`
- `qualityProfileId`
- `minimumAvailability`
- `rootFolderPath`
- `tags`

Maintain indexes by IMDb ID and TMDB ID.

### Sonarr series fields

- `id`
- `imdbId`
- `tvdbId`
- `monitored`
- `qualityProfileId`
- `monitorNewItems`
- `tags`
- `seasons[].seasonNumber`
- `seasons[].monitored`

Maintain indexes by IMDb ID and TVDB ID.

Immediately before a write action, force or perform a fresh item lookup rather than relying solely on the status-tile cache. This closes the race where another client adds the item after the tile was generated.

## Quality profile names

Cache `/api/v3/qualityprofile` results for both Arr services so status tiles and action results can show a meaningful profile name. Fall back safely to `Profile <id>` if discovery fails.

## Tile behaviour

The tile must describe what the click will actually do.

### New item

Show the configured settings that will be applied, for example:

```text
📡: +future ✅new
🎚️: HD-1080p
```

### Existing item under `preserve`

Show the actual existing state, for example:

```text
🛡️: existing settings kept
📡: all eps ✅new
🎚️: Profile 4
```

An existing unmonitored item remains actionable:

```text
🛡️ keep P4 · ep unmonitored
🗯️ 🔍 SEARCH THIS EPISODE
```

The existing configured-scope decorator must not claim that the configured new-item scope will be applied to an existing item when the policy is `preserve`.

## Command acknowledgement

Capture and validate Arr command responses:

```ts
interface ArrCommandResponse {
  id: number;
  name?: string;
  status?: string;
}
```

Return success only when:

- the exact Arr item ID is resolved; and
- the targeted command returns a valid command ID.

Optionally poll `/api/v3/command/{id}` briefly to catch an immediate terminal failure, but do not wait for the complete indexer search or download within the Stremio request.

Example result:

```text
Search queued for SeriesXYZ S02E04.
Existing Profile 4 and monitoring settings were preserved.
```

## New-item search sequencing

Avoid duplicate and broad searches.

### Radarr

- add with `searchForMovie: false` for an add-and-search tile;
- retain the movie ID returned by the add response rather than waiting for list-cache visibility;
- queue one explicit `MoviesSearch` for that exact movie ID.

### Sonarr

- add with `searchForMissingEpisodes: false` and `searchForCutoffUnmetEpisodes: false` for an episode add-and-search tile;
- apply configured monitoring to the new series;
- retain the series ID returned by the add response, then wait for exact episode metadata;
- queue one explicit `EpisodeSearch` for the exact episode ID.

## API source verification

Directly verified against upstream Arr source/API resource implementations:

- Radarr movie resources expose quality profile, monitored state, minimum availability, root folder and tags.
- Radarr manually invoked `MoviesSearch` accepts an unmonitored movie.
- Sonarr series resources expose quality profile, monitored state, `monitorNewItems`, seasons and tags.
- Sonarr season resources expose per-season monitored state.
- Sonarr targeted `EpisodeSearch` executes supplied episode IDs directly.

Official API documentation remains the source of truth. Upstream source inspection is used to confirm current command semantics where the generated API documentation is less explicit.

## Required verification

- typecheck;
- complete unit test suite;
- production build;
- manifest lint;
- release-package smoke test;
- mocked tests only; no real Arr service calls;
- final diff reviewed for accidental changes to unrelated playback, Trakt, catalogue or deployment behaviour.
