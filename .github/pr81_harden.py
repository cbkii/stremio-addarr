from pathlib import Path


def replace_once(path_name: str, old: str, new: str) -> None:
    path = Path(path_name)
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path_name}: expected target exactly once, found {count}')
    path.write_text(text.replace(old, new))


replace_once(
    'src/index.ts',
    """const FILE_PATH_CACHE_TTL_MS = 5 * 60_000;
const INVALID_FILE_ATTEMPTS_PER_MINUTE = 30;
const VALID_FULL_FILE_REQUESTS_PER_MINUTE = 120;
const VALID_RANGE_FILE_REQUESTS_PER_MINUTE = 600;
""",
    """const INVALID_FILE_ATTEMPTS_PER_MINUTE = 30;
"""
)

replace_once(
    'src/index.ts',
    """  const invalidFileRateLimiter = new SlidingWindowRateLimiter(INVALID_FILE_ATTEMPTS_PER_MINUTE, 60_000);
  const validFullFileRateLimiter = new SlidingWindowRateLimiter(VALID_FULL_FILE_REQUESTS_PER_MINUTE, 60_000);
  const validRangeFileRateLimiter = new SlidingWindowRateLimiter(VALID_RANGE_FILE_REQUESTS_PER_MINUTE, 60_000);
  const filePathCache = new FilePathResolverCache(FILE_PATH_CACHE_TTL_MS);
""",
    """  const invalidFileRateLimiter = new SlidingWindowRateLimiter(INVALID_FILE_ATTEMPTS_PER_MINUTE, 60_000);
  // A signed file URL is already the bounded playback capability. Keep its
  // resolved Arr path for the same lifetime so normal long playback does not
  // reacquire a Radarr/Sonarr control-plane dependency mid-session.
  const filePathCacheTtlMs = config.fileStreaming.tokenTtlSec * 1000;
  const filePathCache = new FilePathResolverCache(filePathCacheTtlMs);
"""
)

replace_once(
    'src/index.ts',
    """    invalidRateLimited: 0,
    validRateLimited: 0,
    pathCacheHits: 0,
""",
    """    invalidRateLimited: 0,
    pathCacheHits: 0,
"""
)

replace_once(
    'src/index.ts',
    """        pathCacheTtlMs: FILE_PATH_CACHE_TTL_MS,
""",
    """        pathCacheTtlMs: filePathCacheTtlMs,
"""
)

replace_once(
    'src/index.ts',
    """    const isRangeRequest = typeof req.headers.range === 'string' && req.headers.range.length > 0;
    const validLimiter = isRangeRequest ? validRangeFileRateLimiter : validFullFileRateLimiter;
    if (validLimiter.isLimited(clientIp)) {
      fileStreamingDiagnostics.validRateLimited += 1;
      res.status(429).end();
      return;
    }

    fileStreamingDiagnostics.requests += 1;
""",
    """    const isRangeRequest = typeof req.headers.range === 'string' && req.headers.range.length > 0;
    // Do not count-throttle authenticated media requests. A valid HMAC URL can
    // already transfer the complete file, so request-count limits do not bound
    // bandwidth; they only risk turning player retries/seeks into false 429s.
    fileStreamingDiagnostics.requests += 1;
"""
)

replace_once(
    'src/index.ts',
    """// Legacy action transport only. Passive status tiles are no longer advertised as
// HLS streams; see streamFromTile(). Keep this response bounded while the action
// transport remains the compatibility fallback on Android TV.
""",
    """// Legacy action transport only. Passive status tiles are no longer advertised as
// HLS streams; see streamFromTile(). Plain HTTP(S) URL streams are direct in
// current Stremio Core unless proxy headers/special-source conversion applies,
// so this transport is a player/source lifecycle risk rather than evidence that
// Addarr traffic is proxied through Stremio's torrent streaming server.
"""
)

replace_once(
    'src/addon.ts',
    """  // Passive status entries historically pointed at a zero-duration HLS stream
  // only to satisfy Stream Object source requirements. Keep them selectable but
  // return to the current detail page instead of entering Stremio's player and
  // local streaming-server lifecycle for non-media UI state.
""",
    """  // Passive status entries historically pointed at a zero-duration HLS stream
  // only to satisfy Stream Object source requirements. Keep them selectable but
  // return to the current detail page instead of starting a non-media player/source
  // lifecycle. Current Stremio Core keeps ordinary HTTP(S) URL sources direct;
  // torrent/server state is therefore a separate upstream concern.
"""
)

replace_once(
    'src/services/sonarr.ts',
    """        const sharedEpisodeFile = match.episodeFileId != null && match.episodeFileId > 0
  ? episodes.some((item) => item.id !== match.id && item.episodeFileId === match.episodeFileId)
  : false;
""",
    """        const sharedEpisodeFile = match.episodeFileId != null && match.episodeFileId > 0
          ? episodes.some((item) => item.id !== match.id && item.episodeFileId === match.episodeFileId)
          : false;
"""
)

replace_once(
    'test/file-streaming-lifecycle.test.ts',
    """test('repeated Range requests reuse one Arr file-path resolution and avoid the 120/min full-request limit', async () => {
  await withMovieFile(async ({ baseUrl, cfg, getArrCalls }) => {
    const url = signedFileUrl(baseUrl, cfg, 'movie', 42);
    for (let i = 0; i < 130; i++) {
      const res = await ORIGINAL_FETCH(url, { headers: { Range: 'bytes=0-0' } });
      assert.equal(res.status, 206, `range request ${i + 1}`);
      assert.equal(await res.text(), '0');
    }
    assert.equal(getArrCalls(), 1, 'stable file ID should be resolved once during a playback burst');
  });
});
""",
    """test('valid signed Range traffic stays unthrottled and reuses one Arr path for the signed session', async () => {
  await withMovieFile(async ({ baseUrl, cfg, getArrCalls }) => {
    const url = signedFileUrl(baseUrl, cfg, 'movie', 42);
    for (let i = 0; i < 610; i++) {
      const res = await ORIGINAL_FETCH(url, { headers: { Range: 'bytes=0-0' } });
      assert.equal(res.status, 206, `range request ${i + 1}`);
      assert.equal(await res.text(), '0');
    }
    assert.equal(getArrCalls(), 1, 'stable file ID should be resolved once during a playback burst');
  });
});

test('valid signed full-file retries are not request-count throttled', async () => {
  await withMovieFile(async ({ baseUrl, cfg, getArrCalls }) => {
    const url = signedFileUrl(baseUrl, cfg, 'movie', 42);
    for (let i = 0; i < 130; i++) {
      const res = await ORIGINAL_FETCH(url);
      assert.equal(res.status, 200, `full request ${i + 1}`);
      assert.equal(await res.text(), '0123456789');
    }
    assert.equal(getArrCalls(), 1);
  });
});
"""
)

dead_path = Path('test/dead-stream-mitigation.test.ts')
dead_text = dead_path.read_text()
anchor = """test('single-episode filename classifier accepts common Sonarr names', () => {
  assert.equal(isConfidentSingleEpisodeFilename('Show.Name.S01E02.mkv'), true);
  assert.equal(isConfidentSingleEpisodeFilename('Show Name - 1x02 - Title.mp4'), true);
});
"""
addition = anchor + """
test('shared Sonarr file cannot receive bingeGroup even with a single-episode-looking filename', () => {
  const tile = directSeriesTile('Show.Name.S01E02.mkv');
  tile.bingeEligible = false;
  const stream = streamFromTile(tile);
  assert.equal(stream.behaviorHints?.bingeGroup, undefined);
});
"""
if dead_text.count(anchor) != 1:
    raise SystemExit('dead-stream test insertion anchor missing or duplicated')
dead_path.write_text(dead_text.replace(anchor, addition))

sonarr_test = Path('test/sonarr.test.ts')
sonarr_text = sonarr_test.read_text()
anchor = """test('episode release date prefers airDate (broadcast date) over airDateUtc', async () => {
"""
new_test = """test('episode downloaded status identifies a file shared by multiple logical episodes', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const client = new SonarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/series': [{ id: 22, imdbId: 'tt9', title: 'Show' }],
        '/api/v3/episode?seriesId=22': [
          { id: 7, seasonNumber: 1, episodeNumber: 2, episodeFileId: 55, monitored: true },
          { id: 8, seasonNumber: 1, episodeNumber: 3, episodeFileId: 55, monitored: true }
        ]
      }
    }) as never
  );

  const status = await client.getEpisodeStatus('tt9', 1, 2);
  assert.equal(status.state, 'episode_downloaded');
  assert.equal(status.sharedEpisodeFile, true);
});

""" + anchor
if sonarr_text.count(anchor) != 1:
    raise SystemExit('sonarr test insertion anchor missing or duplicated')
sonarr_test.write_text(sonarr_text.replace(anchor, new_test))

trouble = Path('docs/TROUBLESHOOTING.md')
trouble_text = trouble.read_text()
old = """Some Stremio Android TV versions/devices have upstream reports of persistent local streaming-server state and later stream initialisation failures that recover after Stremio is force-stopped or restarted. See [Stremio/stremio-bugs#2461](https://github.com/Stremio/stremio-bugs/issues/2461) and [Stremio/stremio-bugs#2741](https://github.com/Stremio/stremio-bugs/issues/2741). These reports do not prove that Addarr causes the Stremio bug, and Addarr cannot reset Stremio's internal torrent/P2P engine.
"""
new = """Stremio Android TV has upstream reports of app/player state becoming unhealthy across multiple sources or players, plus separate reports of a persistent `stremio_server_process`. See [Stremio/stremio-bugs#2461](https://github.com/Stremio/stremio-bugs/issues/2461), [#2540](https://github.com/Stremio/stremio-bugs/issues/2540), [#2738](https://github.com/Stremio/stremio-bugs/issues/2738), and [#2741](https://github.com/Stremio/stremio-bugs/issues/2741). These reports do not establish one root cause or prove that Addarr causes the failures.

Current Stremio Core keeps an ordinary HTTP(S) `url` stream direct unless `proxyHeaders` or a special source conversion requires the local streaming server; torrent sources do use the local streaming server. Addarr direct files and its legacy empty-HLS action URL are ordinary URL sources. A failure that appears after Addarr playback can therefore indicate an app/player lifecycle interaction without showing that Addarr traffic passed through or corrupted Stremio's torrent server. Android TV may still keep its server process alive independently of the selected source, so process-level ADB evidence remains useful.
"""
if trouble_text.count(old) != 1:
    raise SystemExit(f'troubleshooting causal paragraph expected once, found {trouble_text.count(old)}')
trouble_text = trouble_text.replace(old, new)
old2 = """If the failure reproduces only after `direct` Addarr playback and not after the Kodi control, that is useful evidence of a Stremio direct-stream/streaming-engine lifecycle interaction rather than a Radarr/Sonarr or individual torrent-addon failure. HTTPS MP4 direct files are advertised as web-ready; MKV, other non-MP4 formats and non-HTTPS URLs retain Stremio's required `notWebReady` hint.
"""
new2 = """If the failure reproduces only after `direct` Addarr playback and not after the Kodi control, that is useful evidence of a Stremio app/player lifecycle interaction correlated with direct playback rather than a Radarr/Sonarr or individual torrent-addon failure. It is **not** evidence that Addarr altered Stremio's torrent engine. HTTPS MP4 direct files are advertised as web-ready; MKV, other non-MP4 formats and non-HTTPS URLs retain Stremio's required `notWebReady` hint.

When reproducing, capture `/status.json` before Addarr playback, immediately after stopping it, and after the later stream failure. The `fileStreaming.diagnostics` counters show whether Addarr finished its HTTP response, saw an early close/abort, reused its path capability, or was still serving a response when Stremio became unhealthy. This separates Addarr's HTTP lifecycle from Stremio process/player state without exposing media paths or signed tokens.
"""
if trouble_text.count(old2) != 1:
    raise SystemExit(f'troubleshooting conclusion expected once, found {trouble_text.count(old2)}')
trouble.write_text(trouble_text.replace(old2, new2))
