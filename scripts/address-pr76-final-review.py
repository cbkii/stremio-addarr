from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one occurrence, found {count}: {old[:120]!r}')
    file_path.write_text(content.replace(old, new, 1), encoding='utf-8')


replace_once(
    'docs/EXISTING-ARR-ITEM-POLICY.md',
    '`preserve` is the default when the setting is absent, including upgrades from older releases.\n',
    '`preserve` is the default when the setting is absent, including upgrades from older releases. Unrecognised values are rejected during startup/configuration validation; they never fall through to `apply-config` or any other mutating policy.\n',
)
replace_once(
    'docs/EXISTING-ARR-ITEM-POLICY.md',
    'If the newly added series has not populated the selected episode yet, invalidate the episode cache and poll until the exact episode appears or the existing bounded readiness timeout expires. Do not silently replace the requested action with a whole-season or whole-series search.\n',
    'If the newly added series has not populated the selected episode yet, invalidate the episode cache and poll until the exact episode appears or the existing bounded readiness timeout expires. If the timeout expires, return an explicit failure, do not claim that a search was queued, and do not silently replace the requested action with a whole-season or whole-series search.\n',
)
replace_once(
    'docs/EXISTING-ARR-ITEM-POLICY.md',
    '- the exact Arr item ID is resolved; and\n- the targeted command returns a valid command ID.\n\nOptionally poll `/api/v3/command/{id}` briefly to catch an immediate terminal failure, but do not wait for the complete indexer search or download within the Stremio request.\n',
    '- the exact Arr item ID is resolved;\n- the exact `MoviesSearch` or `EpisodeSearch` request is posted with that resolved ID;\n- Arr returns a positive command ID; and\n- when Arr includes `name`, it matches the expected command name (case-insensitively).\n\nThe accepted POST response is the acknowledgement invariant used by this implementation. It does not poll command completion. If brief command polling is added later, an immediate terminal failure must map to action failure rather than success; the request must still not wait for indexer or download completion.\n',
)

replace_once(
    'src/services/radarr.ts',
    "    if (!Number.isInteger(command?.id) || Number(command.id) <= 0) {\n",
    "    const commandName = command?.name?.trim().toLowerCase();\n    if (!Number.isInteger(command?.id) || Number(command.id) <= 0 || (commandName != null && commandName !== 'moviessearch')) {\n",
)
replace_once(
    'src/services/radarr.ts',
    "        summary: 'Radarr did not return a valid command acknowledgement.',\n",
    "        summary: 'Radarr did not return a valid targeted MoviesSearch acknowledgement.',\n",
)
replace_once(
    'src/services/sonarr.ts',
    "    if (!Number.isInteger(command?.id) || Number(command.id) <= 0) {\n",
    "    const commandName = command?.name?.trim().toLowerCase();\n    if (!Number.isInteger(command?.id) || Number(command.id) <= 0 || (commandName != null && commandName !== 'episodesearch')) {\n",
)
replace_once(
    'src/services/sonarr.ts',
    "        summary: 'Sonarr did not return a valid command acknowledgement.',\n",
    "        summary: 'Sonarr did not return a valid targeted EpisodeSearch acknowledgement.',\n",
)

with Path('test/existing-item-policy-advanced.test.ts').open('a', encoding='utf-8') as handle:
    handle.write(r'''

test('Radarr rejects a command acknowledgement for the wrong command name', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 50, imdbId: 'tt50', title: 'Wrong Command Movie', monitored: true }],
    command: { id: 500, name: 'EpisodeSearch', status: 'queued' }
  }) as never);

  const result = await client.triggerMovieSearch('tt50');
  assert.equal(result.ok, false);
  assert.match(result.summary, /MoviesSearch acknowledgement/i);
});

test('Sonarr rejects a command acknowledgement for the wrong command name', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 60, imdbId: 'tt60', title: 'Wrong Command Show', monitored: true }],
    episodes: [{ id: 601, seasonNumber: 1, episodeNumber: 1, monitored: true }],
    command: { id: 600, name: 'MoviesSearch', status: 'queued' }
  }) as never);

  const result = await client.triggerEpisodeSearch('tt60', 1, 1);
  assert.equal(result.ok, false);
  assert.match(result.summary, /EpisodeSearch acknowledgement/i);
});
''')

print('PR #76 final review fixes applied.')
