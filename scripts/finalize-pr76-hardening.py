from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one occurrence, found {count}: {old[:80]!r}')
    file_path.write_text(content.replace(old, new, 1), encoding='utf-8')


def append_once(path: str, marker: str, addition: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    if marker in content:
        return
    file_path.write_text(content.rstrip() + '\n\n' + addition.strip() + '\n', encoding='utf-8')


def remove_from_marker(path: str, marker: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    count = content.count(marker)
    if count != 1:
        raise SystemExit(f'{path}: expected one marker, found {count}: {marker!r}')
    file_path.write_text(content.split(marker, 1)[0].rstrip() + '\n', encoding='utf-8')


# Radarr: preserve the returned-ID shortcut only for newly-created movies, and
# always honour a click by queueing the exact search even if the file appeared.
replace_once(
    'src/services/radarr.ts',
    """    let existing: RadarrMovieRecord | undefined = options.knownMovieId != null
      ? { id: options.knownMovieId, imdbId, title: options.knownTitle ?? imdbId }
      : undefined;""",
    """    let existing: RadarrMovieRecord | undefined =
      options.knownMovieId != null && options.existingBeforeAction === false
        ? { id: options.knownMovieId, imdbId, title: options.knownTitle ?? imdbId }
        : undefined;"""
)
replace_once(
    'src/services/radarr.ts',
    """    if (existing.hasFile || existing.movieFile) {
      return {
        ok: true,
        service: 'radarr',
        title: 'Already downloaded',
        summary: 'Movie file already exists.',
        detail: existing.title,
        alreadyExisted: true
      };
    }

""",
    ''
)

# Sonarr: authoritative re-resolution for existing items, exact searches for
# downloaded races, correct monitoring semantics, readiness polling, logging,
# and lookup-error propagation.
replace_once(
    'src/services/sonarr.ts',
    """  private resolveMonitorNewItems(mode: 'ep' | 'epfuture' | 'epseason'): 'all' | 'none' {
    if (this.config.sonarr.monitorNewItems !== 'auto') {
      return this.config.sonarr.monitorNewItems;
    }
    return mode === 'epfuture' ? 'all' : 'none';
  }
""",
    """  private resolveMonitorNewItems(mode: 'ep' | 'epfuture' | 'epseason'): 'all' | 'none' {
    if (this.config.sonarr.monitorNewItems !== 'auto') {
      return this.config.sonarr.monitorNewItems;
    }
    return mode === 'epfuture' ? 'all' : 'none';
  }

  private resolveConfiguredMonitorNewItems(
    mode: AppConfig['sonarr']['seriesMonitor']
  ): 'all' | 'none' {
    if (this.config.sonarr.monitorNewItems !== 'auto') {
      return this.config.sonarr.monitorNewItems;
    }
    return this.isEpisodeScopedMonitorMode(mode)
      ? this.resolveMonitorNewItems(mode)
      : 'all';
  }
"""
)
replace_once(
    'src/services/sonarr.ts',
    """    this.logger.info('sonarr add start', { imdbId });
    const current = await this.findSeriesByImdbId(imdbId, true);
    if (current) {""",
    """    this.logger.info('sonarr add start', { imdbId });
    let current: SonarrSeriesRecord | undefined;
    try {
      current = await this.findSeriesByImdbId(imdbId, true);
    } catch (error) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Sonarr unavailable',
        summary: error instanceof Error ? error.message : 'Sonarr lookup failed.'
      };
    }
    if (current) {"""
)
replace_once(
    'src/services/sonarr.ts',
    """    const lookup = await this.lookupSeries(imdbId);
    if (!lookup) {""",
    """    let lookup: SonarrLookupRecord | null;
    try {
      lookup = await this.lookupSeries(imdbId);
    } catch (error) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Sonarr unavailable',
        summary: error instanceof Error ? error.message : 'Sonarr lookup failed.',
        detail: `IMDb id: ${imdbId}`
      };
    }
    if (!lookup) {"""
)
replace_once(
    'src/services/sonarr.ts',
    """    let episodes: SonarrEpisodeRecord[] = [];
    const episodeWaitStartedAt = Date.now();
    while ((Date.now() - episodeWaitStartedAt) < this.config.sonarr.episodeReadyTimeoutMs) {
      episodes = await this.listEpisodes(series.id);
      if (episodes.length > 0) break;
      this.episodeCache.clear();
      await this.sleep(this.config.sonarr.episodeReadyPollMs);
    }
    if (episodes.length === 0) {
      this.logger.warn('sonarr episode monitor apply failed', { imdbId, reason: 'episode_list_empty', mode });
      return {
        ok: false,
        result: {
          ok: false,
          service: 'sonarr',
          title: 'Sonarr processing delayed',
          summary: 'Series was added, but Sonarr episode list was not ready for monitor update in time.'
        }
      };
    }

    const ordered = episodes
      .filter((item) => item.seasonNumber > 0 && item.episodeNumber > 0 && item.id > 0)
      .sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        return a.episodeNumber - b.episodeNumber;
      });
    const pivot = ordered.find((item) => item.seasonNumber === season && item.episodeNumber === episode);
    if (!pivot) {
      this.logger.warn('sonarr episode monitor apply failed', { imdbId, reason: 'pivot_episode_missing', mode, season, episode });
      return {
        ok: false,
        result: {
          ok: false,
          service: 'sonarr',
          title: 'Episode not found',
          summary: `Series was added, but S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} is not in Sonarr episode metadata yet.`
        }
      };
    }
""",
    """    let ordered: SonarrEpisodeRecord[] = [];
    let pivot: SonarrEpisodeRecord | undefined;
    const episodeWaitStartedAt = Date.now();
    while ((Date.now() - episodeWaitStartedAt) < this.config.sonarr.episodeReadyTimeoutMs) {
      const episodes = await this.listEpisodes(series.id);
      ordered = episodes
        .filter((item) => item.seasonNumber > 0 && item.episodeNumber > 0 && item.id > 0)
        .sort((a, b) => {
          if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
          return a.episodeNumber - b.episodeNumber;
        });
      pivot = ordered.find((item) => item.seasonNumber === season && item.episodeNumber === episode);
      if (pivot) break;
      this.episodeCache.clear();
      await this.sleep(this.config.sonarr.episodeReadyPollMs);
    }
    if (!pivot) {
      this.logger.warn('sonarr episode monitor apply failed', { imdbId, reason: 'pivot_episode_not_ready', mode, season, episode });
      return {
        ok: false,
        result: {
          ok: false,
          service: 'sonarr',
          title: 'Sonarr processing delayed',
          summary: `Series was added, but S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} was not ready for monitor update before the timeout.`
        }
      };
    }
"""
)
replace_once(
    'src/services/sonarr.ts',
    """    let series: SonarrSeriesRecord | undefined = options.knownSeriesId != null
      ? { id: options.knownSeriesId, imdbId, title: options.knownTitle ?? imdbId }
      : undefined;""",
    """    let series: SonarrSeriesRecord | undefined =
      options.knownSeriesId != null && options.existingBeforeAction === false
        ? { id: options.knownSeriesId, imdbId, title: options.knownTitle ?? imdbId }
        : undefined;"""
)
replace_once(
    'src/services/sonarr.ts',
    """    if (exact.hasFile || (exact.episodeFileId ?? 0) > 0) {
      return { ok: true, service: 'sonarr', title: 'Already downloaded', summary: 'Episode file already exists.', detail: series.title, alreadyExisted: true };
    }

""",
    ''
)
replace_once(
    'src/services/sonarr.ts',
    """    this.invalidateCache();
    return {
      ok: true,
      service: 'sonarr',
      title: 'Episode search queued',""",
    """    this.invalidateCache();
    this.logger.info('sonarr episode search queued', {
      imdbId,
      seriesId: series.id,
      episodeId: exact.id,
      commandId: command.id,
      season,
      episode
    });
    return {
      ok: true,
      service: 'sonarr',
      title: 'Episode search queued',"""
)
replace_once(
    'src/services/sonarr.ts',
    """    const monitorMode = this.config.sonarr.seriesMonitor;
    await this.http.put('/api/v3/series/editor', {
      seriesIds: [series.id],
      monitored: monitorMode !== 'none',
      monitorNewItems: this.config.sonarr.monitorNewItems === 'auto'
        ? (monitorMode === 'epfuture' || monitorMode === 'future' || monitorMode === 'all' ? 'all' : 'none')
        : this.config.sonarr.monitorNewItems,
      qualityProfileId: this.config.sonarr.qualityProfileId,""",
    """    const monitorMode = this.config.sonarr.seriesMonitor;
    await this.http.put('/api/v3/series/editor', {
      seriesIds: [series.id],
      ...(monitorMode === 'skip' ? {} : { monitored: monitorMode !== 'none' }),
      monitorNewItems: this.resolveConfiguredMonitorNewItems(monitorMode),
      qualityProfileId: this.config.sonarr.qualityProfileId,"""
)
replace_once(
    'src/services/sonarr.ts',
    """    let lookup: SonarrLookupRecord | null = null;
    try {
      lookup = await this.lookupSeries(imdbId);
    } catch {
      return undefined;
    }
    if (!lookup) return undefined;""",
    """    const lookup = await this.lookupSeries(imdbId);
    if (!lookup) return undefined;"""
)

# Tile/action orchestration: show season state, keep action descriptions compact,
# and carry returned IDs only across post-create visibility races.
replace_once(
    'src/services/status.ts',
    """function actualSeriesMonitorLine(status: ArrEpisodeStatus): string {
  const series = status.seriesMonitored ? 'series on' : 'series off';
  const episode = status.episodeId != null ? (status.monitored ? 'ep on' : 'ep off') : '';
  const future = status.monitorNewItems === 'all' ? '✅new' : status.monitorNewItems === 'none' ? '❌new' : '';
  return `📡: ${[series, episode, future].filter(Boolean).join(' ')}`;
}
""",
    """function actualSeriesMonitorLine(status: ArrEpisodeStatus): string {
  const series = status.seriesMonitored ? 'series on' : 'series off';
  const season = status.seasonMonitored == null ? '' : (status.seasonMonitored ? 'season on' : 'season off');
  const episode = status.episodeId != null ? (status.monitored ? 'ep on' : 'ep off') : '';
  const future = status.monitorNewItems === 'all' ? '✅new' : status.monitorNewItems === 'none' ? '❌new' : '';
  return `📡: ${[series, season, episode, future].filter(Boolean).join(' ')}`;
}

function existingPolicyProfileLine(
  policy: AppConfig['sonarr']['existingItemPolicy'] | undefined,
  profileName?: string,
  profileId?: number
): string {
  return [existingPolicyLine(policy), profileLine(profileName, profileId)]
    .filter(Boolean)
    .join(' · ');
}
"""
)
replace_once(
    'src/services/status.ts',
    """description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} missing` : '⭕ Episode missing', existingPolicyLine(status.existingItemPolicy), actualSeriesMonitorLine(status), profileLine(status.qualityProfileName, status.qualityProfileId), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),""",
    """description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} missing` : '⭕ Episode missing', existingPolicyProfileLine(status.existingItemPolicy, status.qualityProfileName, status.qualityProfileId), actualSeriesMonitorLine(status), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),"""
)
replace_once(
    'src/services/status.ts',
    """description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} ${status.monitored ? 'monitored' : 'unmonitored'}` : '⭕ In library', existingPolicyLine(status.existingItemPolicy), actualSeriesMonitorLine(status), profileLine(status.qualityProfileName, status.qualityProfileId), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),""",
    """description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} ${status.monitored ? 'monitored' : 'unmonitored'}` : '⭕ In library', existingPolicyProfileLine(status.existingItemPolicy, status.qualityProfileName, status.qualityProfileId), actualSeriesMonitorLine(status), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),"""
)
replace_once(
    'src/services/status.ts',
    """        knownMovieId: added.itemId,
        knownTitle: added.detail?.split(' · ', 1)[0]""",
    """        knownMovieId: added.alreadyExisted === true ? undefined : added.itemId,
        knownTitle: added.alreadyExisted === true ? undefined : added.detail"""
)
replace_once(
    'src/services/status.ts',
    """        knownSeriesId: added.itemId,
        knownTitle: added.detail""",
    """        knownSeriesId: added.alreadyExisted === true ? undefined : added.itemId,
        knownTitle: added.alreadyExisted === true ? undefined : added.detail"""
)

# Configure UI: preserve case-insensitive policy support on read and write.
replace_once(
    'src/config-ui-core.ts',
    """      existingItemPolicy: pendingValue(pending, 'RADARR_EXISTING_ITEM_POLICY', config.radarr.existingItemPolicy)""",
    """      existingItemPolicy: pendingValue(pending, 'RADARR_EXISTING_ITEM_POLICY', config.radarr.existingItemPolicy).toLowerCase()"""
)
replace_once(
    'src/config-ui-core.ts',
    """      existingItemPolicy: pendingValue(pending, 'SONARR_EXISTING_ITEM_POLICY', config.sonarr.existingItemPolicy)""",
    """      existingItemPolicy: pendingValue(pending, 'SONARR_EXISTING_ITEM_POLICY', config.sonarr.existingItemPolicy).toLowerCase()"""
)
replace_once(
    'src/config-ui-core.ts',
    """  const radarrExistingPolicy = readStringField(radarr, 'existingItemPolicy', config.radarr.existingItemPolicy) as AppConfig['radarr']['existingItemPolicy'];""",
    """  const radarrExistingPolicy = readStringField(radarr, 'existingItemPolicy', config.radarr.existingItemPolicy).toLowerCase() as AppConfig['radarr']['existingItemPolicy'];"""
)
replace_once(
    'src/config-ui-core.ts',
    """  const sonarrExistingPolicy = readStringField(sonarr, 'existingItemPolicy', config.sonarr.existingItemPolicy) as AppConfig['sonarr']['existingItemPolicy'];""",
    """  const sonarrExistingPolicy = readStringField(sonarr, 'existingItemPolicy', config.sonarr.existingItemPolicy).toLowerCase() as AppConfig['sonarr']['existingItemPolicy'];"""
)

# Remove the obsolete addon alias and dead series-scope decorator.
replace_once(
    'src/addon.ts',
    """    const tiles = await statusService.buildTiles(parsed);
    const displayTiles = tiles;

    logger?.info('stream handler complete', { type, id, tileCount: displayTiles.length, durationMs: Date.now() - start });

    return {
      streams: displayTiles.map(streamFromTile),""",
    """    const tiles = await statusService.buildTiles(parsed);

    logger?.info('stream handler complete', { type, id, tileCount: tiles.length, durationMs: Date.now() - start });

    return {
      streams: tiles.map(streamFromTile),"""
)
replace_once(
    'src/services/series-monitor-scope.ts',
    """import type { StatusTile } from '../types.js';

""",
    ''
)
remove_from_marker(
    'src/services/series-monitor-scope.ts',
    '\nexport function addSeriesMonitorScopeToActionTiles('
)

# Route-level exact-search tests must assert command name and target IDs.
replace_once(
    'test/app-routes.test.ts',
    """    if (path === '/api/v3/command' && init?.method === 'POST') {
      resolveCommandPosted();
      return new Response('{\"id\":1001,\"name\":\"MoviesSearch\",\"status\":\"queued\"}', { status: 201 });
    }""",
    """    if (path === '/api/v3/command' && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { name: 'MoviesSearch', movieIds: [100] });
      resolveCommandPosted();
      return new Response('{\"id\":1001,\"name\":\"MoviesSearch\",\"status\":\"queued\"}', { status: 201 });
    }"""
)
replace_once(
    'test/app-routes.test.ts',
    """    if (path === '/api/v3/command' && init?.method === 'POST') {
      resolveCommandPosted();
      return new Response('{\"id\":2001,\"name\":\"EpisodeSearch\",\"status\":\"queued\"}', { status: 201 });
    }""",
    """    if (path === '/api/v3/command' && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { name: 'EpisodeSearch', episodeIds: [45] });
      resolveCommandPosted();
      return new Response('{\"id\":2001,\"name\":\"EpisodeSearch\",\"status\":\"queued\"}', { status: 201 });
    }"""
)
replace_once(
    'test/app-routes.test.ts',
    """    if (path === '/api/v3/command' && init?.method === 'POST') {
      resolveCommandPosted();
      return new Response('{\"id\":3001,\"name\":\"EpisodeSearch\",\"status\":\"queued\"}', { status: 201 });
    }""",
    """    if (path === '/api/v3/command' && init?.method === 'POST') {
      assert.deepEqual(JSON.parse(String(init.body)), { name: 'EpisodeSearch', episodeIds: [112] });
      resolveCommandPosted();
      return new Response('{\"id\":3001,\"name\":\"EpisodeSearch\",\"status\":\"queued\"}', { status: 201 });
    }"""
)

# Restore documented downloaded-tile compactness and assert compact action tiles.
replace_once(
    'test/status-watched.test.ts',
    """  assert.ok(lines.length <= 7);
});

test('movie missing description""",
    """  assert.ok(lines.length <= 5);
});

test('movie missing description"""
)
replace_once(
    'test/status-watched.test.ts',
    """  assert.ok(lines.length <= 7);
});

test('episode missing description""",
    """  assert.ok(lines.length <= 5);
});

test('episode missing description"""
)
replace_once(
    'test/episode-monitor-scope.test.ts',
    """    assert.ok(lines.includes('🛡️: existing settings kept'));
    assert.ok(lines.includes('📡: series on ep on ✅new'));
    assert.ok(lines.includes('🎚️: Profile 4'));
    assert.equal(lines.filter((line) => line.startsWith('📡:')).length, 1);""",
    """    assert.ok(lines.some((line) => line.includes('🛡️: existing settings kept') && line.includes('🎚️: Profile 4')));
    assert.ok(lines.includes('📡: series on season on ep on ✅new'));
    assert.equal(lines.filter((line) => line.startsWith('📡:')).length, 1);
    assert.ok(lines.length <= 7);"""
)

# Case-insensitive environment policy values must round-trip in Configure.
append_once(
    'test/config-ui.test.ts',
    "test('Configure normalizes case-insensitive existing-item policies')",
    r"""
test('Configure normalizes case-insensitive existing-item policies', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  const envFile = await tempEnv('RADARR_EXISTING_ITEM_POLICY=EXTEND\nSONARR_EXISTING_ITEM_POLICY=APPLY-CONFIG\n');
  process.env['CONFIG_UI_ENV_FILE'] = envFile;
  const app = createApp(uiConfig());

  await withServer(app, async (baseUrl) => {
    const session = await login(baseUrl, process.env['CONFIG_UI_TOKEN']!);
    const currentResponse = await ORIGINAL_FETCH(`${baseUrl}/api/config`, { headers: { cookie: session.cookie } });
    const current = (await currentResponse.json()) as { csrf: string; config: Record<string, any> };
    assert.equal(current.config.radarr.existingItemPolicy, 'extend');
    assert.equal(current.config.sonarr.existingItemPolicy, 'apply-config');

    const saveResponse = await ORIGINAL_FETCH(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: {
        cookie: session.cookie,
        'content-type': 'application/json',
        'x-csrf-token': current.csrf
      },
      body: JSON.stringify(current.config)
    });
    const saveText = await saveResponse.text();
    assert.equal(saveResponse.status, 200, saveText);
    const saved = await fs.readFile(envFile, 'utf8');
    assert.match(saved, /RADARR_EXISTING_ITEM_POLICY=extend/);
    assert.match(saved, /SONARR_EXISTING_ITEM_POLICY=apply-config/);
  });
});
"""
)

# Focused regressions for every valid behavioural review finding.
append_once(
    'test/existing-item-policy-advanced.test.ts',
    "test('existing Radarr add-search re-resolves authoritative state before extend')",
    r"""
test('existing Radarr add-search re-resolves authoritative state before extend', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarr.existingItemPolicy = 'extend';
  const calls: Call[] = [];
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 81, imdbId: 'tt81', title: 'Existing Movie', monitored: false, qualityProfileId: 4 }],
    command: { id: 810, name: 'MoviesSearch' },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerMovieSearch('tt81', {
    existingBeforeAction: true,
    knownMovieId: 81,
    knownTitle: 'Synthetic title'
  });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.filter((call) => call.method !== 'GET'), [
    { method: 'PUT', path: '/api/v3/movie/editor', body: { movieIds: [81], monitored: true } },
    { method: 'POST', path: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [81] } }
  ]);
});

test('downloaded Radarr movie still queues the exact requested search', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const calls: Call[] = [];
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 82, imdbId: 'tt82', title: 'Downloaded Movie', monitored: true, hasFile: true }],
    command: { id: 820, name: 'MoviesSearch' },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerMovieSearch('tt82');
  assert.equal(result.ok, true);
  assert.deepEqual(calls.filter((call) => call.path === '/api/v3/command')[0]?.body, {
    name: 'MoviesSearch', movieIds: [82]
  });
});

test('existing Sonarr add-search re-resolves state and avoids redundant extend mutation', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.existingItemPolicy = 'extend';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 83, imdbId: 'tt83', title: 'Existing Show', monitored: true }],
    episodes: [{ id: 831, seasonNumber: 1, episodeNumber: 1, monitored: true }],
    command: { id: 830, name: 'EpisodeSearch' },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerEpisodeSearch('tt83', 1, 1, {
    existingBeforeAction: true,
    knownSeriesId: 83,
    knownTitle: 'Synthetic title'
  });
  assert.equal(result.ok, true);
  assert.equal(calls.filter((call) => call.method === 'PUT').length, 0);
  assert.deepEqual(calls.filter((call) => call.path === '/api/v3/command')[0]?.body, {
    name: 'EpisodeSearch', episodeIds: [831]
  });
});

test('downloaded Sonarr episode still queues the exact requested search', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 84, imdbId: 'tt84', title: 'Downloaded Show', monitored: true }],
    episodes: [{ id: 841, seasonNumber: 1, episodeNumber: 1, monitored: true, hasFile: true }],
    command: { id: 840, name: 'EpisodeSearch' },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerEpisodeSearch('tt84', 1, 1);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.filter((call) => call.path === '/api/v3/command')[0]?.body, {
    name: 'EpisodeSearch', episodeIds: [841]
  });
});

test('Sonarr apply-config skip preserves series monitored and auto keeps new items enabled', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.existingItemPolicy = 'apply-config';
  cfg.sonarr.seriesMonitor = 'skip';
  cfg.sonarr.monitorNewItems = 'auto';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 85, imdbId: 'tt85', title: 'Skip Show', monitored: false }],
    episodes: [{ id: 851, seasonNumber: 1, episodeNumber: 1, monitored: false }],
    command: { id: 850, name: 'EpisodeSearch' },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerEpisodeSearch('tt85', 1, 1);
  assert.equal(result.ok, true);
  const editor = calls.find((call) => call.path === '/api/v3/series/editor');
  assert.ok(editor);
  assert.equal(Object.hasOwn(editor!.body as object, 'monitored'), false);
  assert.equal((editor!.body as { monitorNewItems?: string }).monitorNewItems, 'all');
});

test('episode-scoped monitoring waits through partial metadata until the pivot appears', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 50;
  let episodeReads = 0;
  const calls: Call[] = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      calls.push({ method: 'GET', path });
      if (path === '/api/v3/series') return [] as T;
      if (path.startsWith('/api/v3/series/lookup')) return [{ title: 'Partial Show', imdbId: 'tt86', tvdbId: 86 }] as T;
      if (path.startsWith('/api/v3/episode?seriesId=86')) {
        episodeReads++;
        return (episodeReads === 1
          ? [{ id: 860, seasonNumber: 1, episodeNumber: 1, monitored: false }]
          : [
            { id: 860, seasonNumber: 1, episodeNumber: 1, monitored: false },
            { id: 861, seasonNumber: 1, episodeNumber: 2, monitored: false }
          ]) as T;
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: 'POST', path, body });
      if (path === '/api/v3/series') return { id: 86, title: 'Partial Show', imdbId: 'tt86', tvdbId: 86 } as T;
      if (path === '/api/v3/command') return { id: 8600, name: 'EpisodeSearch' } as T;
      throw new Error(`Unexpected POST ${path}`);
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: 'PUT', path, body });
      return {} as T;
    }
  };

  const result = await new SonarrClient(cfg, http as never).addSeriesByImdbId('tt86', { season: 1, episode: 2 });
  assert.equal(result.ok, true);
  assert.ok(episodeReads >= 2);
  assert.ok(calls.some((call) => call.path === '/api/v3/episode/monitor' && (call.body as any).episodeIds.includes(861)));
});

test('Sonarr lookup transport failures are reported as unavailable', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [] as T;
      if (path.startsWith('/api/v3/series/lookup')) throw new Error('sonarr lookup transport failed');
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(): Promise<T> { return {} as T; },
    async put<T>(): Promise<T> { return {} as T; }
  };
  const client = new SonarrClient(cfg, http as never);

  const status = await client.getEpisodeStatus('tt87', 1, 1);
  assert.equal(status.state, 'unavailable');
  assert.match(status.reason ?? '', /lookup transport failed/i);
  const action = await client.triggerEpisodeSearch('tt87', 1, 1);
  assert.equal(action.ok, false);
  assert.equal(action.title, 'Sonarr unavailable');
  assert.match(action.summary, /lookup transport failed/i);
  const add = await client.addSeriesByImdbId('tt87', { season: 1, episode: 1 });
  assert.equal(add.ok, false);
  assert.equal(add.title, 'Sonarr unavailable');
  assert.match(add.summary, /lookup transport failed/i);
});
"""
)

# Keep documentation aligned with current implementation boundaries and races.
replace_once(
    'docs/EXISTING-ARR-ITEM-POLICY.md',
    """Cache `/api/v3/qualityprofile` results for both Arr services so status tiles and action results can show a meaningful profile name. Fall back safely to `Profile <id>` if discovery fails.""",
    """Cache `/api/v3/qualityprofile` results for both Arr services so existing-item status tiles and action context can show a meaningful profile name. New-item tiles and configured apply-results may use `Profile <id>` because they render from configuration before an item resource is available. Fall back safely to `Profile <id>` whenever discovery is unavailable."""
)
replace_once(
    'docs/EXISTING-ARR-ITEM-POLICY.md',
    """- when Arr includes `name`, it matches the expected command name (case-insensitively).

The accepted POST response""",
    """- when Arr includes `name`, it matches the expected command name (case-insensitively).

This exact-search invariant still applies if the file finishes downloading between tile rendering and action execution; a click that was offered as a search action must not silently become a no-op.

The accepted POST response"""
)
replace_once(
    'docs/EXISTING-ARR-ITEM-POLICY.md',
    """- apply configured monitoring to the new series;
- retain the series ID returned by the add response, then wait for exact episode metadata;
- queue one explicit `EpisodeSearch` for the exact episode ID.""",
    """- apply configured monitoring to the new series;
- retain the series ID returned by the add response, then keep polling through partial episode lists until the exact selected episode appears or the bounded readiness timeout expires;
- queue one explicit `EpisodeSearch` for the exact episode ID."""
)

print('PR #76 hardening patch applied.')
