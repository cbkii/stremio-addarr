from __future__ import annotations

from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one occurrence, found {count}: {old[:140]!r}')
    file_path.write_text(content.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/services/radarr.ts',
    "    const policyDetail = options.existingBeforeAction === false\n      ? 'Configured settings applied to the new movie.'\n      : await this.applyExistingMoviePolicy(existing);\n\n    const command = await this.http.post<ArrCommandResponse>('/api/v3/command', {\n      name: 'MoviesSearch',\n      movieIds: [existing.id]\n    });\n",
    "    let policyDetail: string;\n    let command: ArrCommandResponse;\n    try {\n      policyDetail = options.existingBeforeAction === false\n        ? 'Configured settings applied to the new movie.'\n        : await this.applyExistingMoviePolicy(existing);\n      command = await this.http.post<ArrCommandResponse>('/api/v3/command', {\n        name: 'MoviesSearch',\n        movieIds: [existing.id]\n      });\n    } catch (error) {\n      return {\n        ok: false,\n        service: 'radarr',\n        title: 'Radarr action failed',\n        summary: error instanceof Error ? error.message : 'Radarr rejected the movie policy or search request.',\n        detail: existing.title\n      };\n    }\n",
)

replace_once(
    'src/services/sonarr.ts',
    "    const exact = await this.waitForEpisode(series.id, season, episode);\n    if (!exact) {",
    "    let exact: SonarrEpisodeRecord | undefined;\n    try {\n      exact = await this.waitForEpisode(series.id, season, episode);\n    } catch (error) {\n      return {\n        ok: false,\n        service: 'sonarr',\n        title: 'Sonarr action failed',\n        summary: error instanceof Error ? error.message : 'Sonarr could not resolve the exact episode.',\n        detail: `${series.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`\n      };\n    }\n    if (!exact) {",
)
replace_once(
    'src/services/sonarr.ts',
    "    const policyDetail = options.existingBeforeAction === false\n      ? 'Configured settings applied to the new series.'\n      : await this.applyExistingSeriesPolicy(imdbId, series, exact, season, episode);\n\n    const command = await this.http.post<ArrCommandResponse>('/api/v3/command', {\n      name: 'EpisodeSearch',\n      episodeIds: [exact.id]\n    });\n",
    "    let policyDetail: string;\n    let command: ArrCommandResponse;\n    try {\n      policyDetail = options.existingBeforeAction === false\n        ? 'Configured settings applied to the new series.'\n        : await this.applyExistingSeriesPolicy(imdbId, series, exact, season, episode);\n      command = await this.http.post<ArrCommandResponse>('/api/v3/command', {\n        name: 'EpisodeSearch',\n        episodeIds: [exact.id]\n      });\n    } catch (error) {\n      return {\n        ok: false,\n        service: 'sonarr',\n        title: 'Sonarr action failed',\n        summary: error instanceof Error ? error.message : 'Sonarr rejected the series policy or episode search request.',\n        detail: `${series.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`\n      };\n    }\n",
)

with Path('test/existing-item-policy-advanced.test.ts').open('a', encoding='utf-8') as handle:
    handle.write(r'''

test('Radarr command transport failure returns a structured action result', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [{ id: 70, imdbId: 'tt70', title: 'Offline Movie', monitored: true }] as T;
      if (path === '/api/v3/qualityprofile') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(): Promise<T> { throw new Error('radarr command transport failed'); },
    async put<T>(): Promise<T> { return {} as T; }
  };

  const result = await new RadarrClient(cfg, http as never).triggerMovieSearch('tt70');
  assert.equal(result.ok, false);
  assert.equal(result.service, 'radarr');
  assert.equal(result.title, 'Radarr action failed');
  assert.match(result.summary, /command transport failed/i);
});

test('Sonarr policy mutation failure returns a structured action result', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.existingItemPolicy = 'apply-config';
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 80, imdbId: 'tt80', title: 'Policy Failure Show', monitored: true }] as T;
      if (path === '/api/v3/episode?seriesId=80') return [{ id: 801, seasonNumber: 1, episodeNumber: 1, monitored: true }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(): Promise<T> { return { id: 800, name: 'EpisodeSearch' } as T; },
    async put<T>(): Promise<T> { throw new Error('sonarr policy mutation failed'); }
  };

  const result = await new SonarrClient(cfg, http as never).triggerEpisodeSearch('tt80', 1, 1);
  assert.equal(result.ok, false);
  assert.equal(result.service, 'sonarr');
  assert.equal(result.title, 'Sonarr action failed');
  assert.match(result.summary, /policy mutation failed/i);
});
''')

print('Structured Arr action failure handling applied.')
