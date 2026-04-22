import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { systemClock, type Clock } from '../lib/clock.js';
import type {
  CatalogItem,
  RadarrHistoryRecord,
  RadarrMovieRecord,
  RadarrQueueRecord,
  SonarrHistoryRecord,
  SonarrQueueRecord,
  SonarrSeriesRecord
} from '../types.js';
import { RadarrClient } from './radarr.js';
import { SonarrClient } from './sonarr.js';

const DAY_MS = 86_400_000;
const IMDB_ID_PATTERN = /^tt\d+$/i;

function normalizeImdbId(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !IMDB_ID_PATTERN.test(trimmed)) return undefined;
  return `tt${trimmed.slice(2)}`;
}

function toTimestamp(value?: string): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatRelativeImport(timestamp: number, nowMs: number): string {
  if (!timestamp) return 'Imported recently';
  const days = Math.floor(Math.max(0, nowMs - timestamp) / DAY_MS);
  return days <= 0 ? 'Imported today' : `Imported ${days}d ago`;
}

function formatRelativeAdded(timestamp: number, nowMs: number): string {
  if (!timestamp) return 'Added recently';
  const days = Math.floor(Math.max(0, nowMs - timestamp) / DAY_MS);
  return days <= 0 ? 'Added today' : `Added ${days}d ago`;
}

function parseEtaSeconds(value?: string): number | undefined {
  if (!value) return undefined;
  const match = /(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return undefined;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);
  return (((days * 24) + hours) * 60 + minutes) * 60 + seconds;
}

function formatEta(seconds?: number): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return 'ETA unknown';
  if (seconds < 3600) return `ETA ${Math.max(1, Math.round(seconds / 60))}m`;
  const hrs = Math.round(seconds / 3600);
  return `ETA ${hrs}h`;
}

function progressFromSizes(size?: number, sizeleft?: number): number | undefined {
  if (!size || size <= 0 || sizeleft == null) return undefined;
  const pct = Math.round(((size - sizeleft) / size) * 100);
  return Math.max(0, Math.min(100, pct));
}

function firstMessage(messages?: Array<{ title?: string; messages?: string[] }>): string | undefined {
  const title = messages?.find((item) => item?.title)?.title?.trim();
  if (title) return title;
  const msg = messages?.find((item) => item?.messages?.[0])?.messages?.[0]?.trim();
  return msg || undefined;
}

function compact(parts: Array<string | undefined>, maxLen = 80): string | undefined {
  const text = parts.filter(Boolean).join(' • ');
  if (!text) return undefined;
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}

function episodeLabel(season?: number, episode?: number): string {
  if (season == null || episode == null) return '';
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

function pickPoster(images?: Array<{ coverType?: string; remoteUrl?: string; url?: string }>): string | undefined {
  if (!images?.length) return undefined;
  const preferred = images.find((img) => /^poster$/i.test(img.coverType ?? ''))
    ?? images.find((img) => /^fanart$/i.test(img.coverType ?? ''))
    ?? images[0];
  const remote = preferred?.remoteUrl?.trim();
  if (remote && /^https?:\/\//i.test(remote)) {
    return remote;
  }
  return undefined;
}

export function downloadingReleaseInfo(progressPct?: number, etaSeconds?: number, stalled?: boolean): string {
  if (stalled) return 'Downloading • Stalled';
  if (progressPct != null) return `Downloading ${progressPct}% • ${formatEta(etaSeconds)}`;
  return `Downloading • ${formatEta(etaSeconds)}`;
}

function downloadingSortKey(item: CatalogItem): [number, number, number, string] {
  return [
    item.stalled ? 1 : 0,
    -(item.progressPct ?? -1),
    item.etaSeconds ?? Number.MAX_SAFE_INTEGER,
    item.title.toLowerCase()
  ];
}

function shouldPreferDownloading(candidate: CatalogItem, existing: CatalogItem): boolean {
  const ck = downloadingSortKey(candidate);
  const ek = downloadingSortKey(existing);
  if (ck[0] !== ek[0]) return ck[0] < ek[0];
  if (ck[1] !== ek[1]) return ck[1] < ek[1];
  if (ck[2] !== ek[2]) return ck[2] < ek[2];
  return ck[3] < ek[3];
}

export function mergeMovieItems(items: CatalogItem[]): CatalogItem[] {
  const bestByImdb = new Map<string, CatalogItem>();
  for (const item of items) {
    const current = bestByImdb.get(item.imdbId);
    if (!current) {
      bestByImdb.set(item.imdbId, item);
      continue;
    }
    if (!current.poster && item.poster) {
      current.poster = item.poster;
    }
    if (current.status === 'imported' && item.status === 'downloading') {
      bestByImdb.set(item.imdbId, item);
      continue;
    }
    if (current.status === 'downloading' && item.status === 'downloading') {
      if (shouldPreferDownloading(item, current)) {
        bestByImdb.set(item.imdbId, item);
      }
      continue;
    }
    if (current.status === item.status && item.timestamp > current.timestamp) {
      bestByImdb.set(item.imdbId, item);
    }
  }

  const values = [...bestByImdb.values()];
  const downloading = values.filter((item) => item.status === 'downloading').sort((a, b) => {
    const ak = downloadingSortKey(a);
    const bk = downloadingSortKey(b);
    return ak[0] - bk[0] || ak[1] - bk[1] || ak[2] - bk[2] || ak[3].localeCompare(bk[3]);
  });
  const imported = values.filter((item) => item.status === 'imported').sort((a, b) => {
    return (b.timestamp - a.timestamp) || ((b.addedTimestamp ?? 0) - (a.addedTimestamp ?? 0));
  });
  return [...downloading, ...imported];
}

export function mergeSeriesItems(items: CatalogItem[]): CatalogItem[] {
  const byImdb = new Map<string, CatalogItem>();
  for (const item of items) {
    const current = byImdb.get(item.imdbId);
    if (!current) {
      byImdb.set(item.imdbId, item);
      continue;
    }
    if (!current.poster && item.poster) {
      current.poster = item.poster;
    }
    if (current.status === 'imported' && item.status === 'downloading') {
      byImdb.set(item.imdbId, item);
      continue;
    }
    if (current.status === 'downloading' && item.status === 'downloading') {
      if (shouldPreferDownloading(item, current)) {
        byImdb.set(item.imdbId, item);
      }
      continue;
    }
    if (current.status === item.status && item.timestamp > current.timestamp) {
      byImdb.set(item.imdbId, item);
    }
  }

  const values = [...byImdb.values()];
  const downloading = values.filter((item) => item.status === 'downloading').sort((a, b) => {
    const ak = downloadingSortKey(a);
    const bk = downloadingSortKey(b);
    return ak[0] - bk[0] || ak[1] - bk[1] || ak[2] - bk[2] || ak[3].localeCompare(bk[3]);
  });
  const imported = values.filter((item) => item.status === 'imported').sort((a, b) => {
    return (b.timestamp - a.timestamp) || ((b.addedTimestamp ?? 0) - (a.addedTimestamp ?? 0));
  });
  return [...downloading, ...imported];
}

interface CatalogMetaPreview {
  id: string;
  type: 'movie' | 'series';
  name: string;
  poster: string;
  releaseInfo: string;
  description?: string;
}

function metahubPoster(imdbId: string): string {
  return `https://images.metahub.space/poster/medium/${encodeURIComponent(imdbId)}/img`;
}

function toMeta(item: CatalogItem): CatalogMetaPreview {
  return {
    // Keep canonical IMDb IDs so Stremio can resolve posters/details via Cinemeta.
    id: item.imdbId,
    type: item.type,
    name: item.title,
    poster: item.poster ?? metahubPoster(item.imdbId),
    releaseInfo: item.releaseInfo,
    description: item.description
  };
}

export class CatalogService {
  private readonly radarr: RadarrClient;
  private readonly sonarr: SonarrClient;
  private readonly clock: Clock;
  private readonly mergedCache: TtlCache<CatalogItem[]>;

  constructor(
    private readonly config: AppConfig,
    deps?: { radarr?: RadarrClient; sonarr?: SonarrClient; clock?: Clock }
  ) {
    this.radarr = deps?.radarr ?? new RadarrClient(config);
    this.sonarr = deps?.sonarr ?? new SonarrClient(config);
    this.clock = deps?.clock ?? systemClock;
    this.mergedCache = new TtlCache<CatalogItem[]>(config.catalogCacheTtlMs);
  }

  async buildCatalog(catalogId: string, skip: number, limit: number): Promise<{ metas: CatalogMetaPreview[] }> {
    const key = `${catalogId}:${skip}:${limit}`;
    const cached = this.mergedCache.get(key);
    if (cached) {
      return { metas: cached.map(toMeta) };
    }

    let items: CatalogItem[] = [];
    if (catalogId === 'radarr-recent') {
      items = await this.buildRadarrItems(skip, limit);
    } else if (catalogId === 'sonarr-recent') {
      items = await this.buildSonarrItems(skip, limit);
    }
    this.mergedCache.set(key, items);
    return { metas: items.map(toMeta) };
  }

  private async buildRadarrItems(skip: number, limit: number): Promise<CatalogItem[]> {
    if (!this.config.radarr.enabled) return [];
    try {
      const nowMs = this.clock.now();
      const movies = await this.radarr.listMovies().catch(() => []);
      const queue = await this.radarr.listMovieQueueDetails().catch(() => []);
      const historyWindow = Math.max(100, skip + limit + queue.length + movies.length + 25);
      const history = await this.radarr.listRecentMovieImports(historyWindow, 0).catch(() => []);

    const moviesById = new Map<number, RadarrMovieRecord>();
    for (const movie of movies) {
      if (movie.id != null) moviesById.set(movie.id, movie);
    }

    const queueItems: CatalogItem[] = [];
    for (const row of queue) {
      try {
        const movie = row.movieId != null ? moviesById.get(row.movieId) : undefined;
        const imdbId = normalizeImdbId(movie?.imdbId ?? row.movie?.imdbId);
        if (!imdbId) continue;

        const etaSeconds = parseEtaSeconds(row.timeleft) ?? (row.estimatedCompletionTime ? Math.max(0, Math.round((toTimestamp(row.estimatedCompletionTime) - nowMs) / 1000)) : undefined);
        const stalled = /stalled/i.test(`${row.trackedDownloadStatus ?? ''} ${row.trackedDownloadState ?? ''} ${row.status ?? ''}`) || /stalled/i.test(firstMessage(row.statusMessages) ?? '');
        const progressPct = progressFromSizes(row.size, row.sizeleft);

        queueItems.push({
          source: 'radarr',
          status: 'downloading',
          type: 'movie',
          imdbId,
          title: movie?.title ?? row.movie?.title ?? row.title ?? 'Unknown movie',
          poster: pickPoster(movie?.images),
          releaseInfo: downloadingReleaseInfo(progressPct, etaSeconds, stalled),
          description: compact([row.quality?.quality?.name, row.protocol, stalled ? firstMessage(row.statusMessages) : undefined, row.title]),
          timestamp: nowMs,
          progressPct,
          etaSeconds,
          stalled
        });
      } catch {
        continue;
      }
    }

    const latestImportByMovieId = new Map<number, { timestamp: number; row: RadarrHistoryRecord }>();
    for (const row of history) {
      if (row.movieId == null) continue;
      const ts = toTimestamp(row.date);
      if (!ts) continue;
      const existing = latestImportByMovieId.get(row.movieId);
      if (!existing || ts > existing.timestamp) {
        latestImportByMovieId.set(row.movieId, { timestamp: ts, row });
      }
    }

    const importItems: CatalogItem[] = [];
    for (const movie of movies) {
      try {
        const imdbId = normalizeImdbId(movie.imdbId);
        if (!imdbId) continue;

        const latestImport = latestImportByMovieId.get(movie.id);
        const importedTs = latestImport?.timestamp ?? 0;
        const addedTs = toTimestamp(movie.added);
        importItems.push({
          source: 'radarr',
          status: 'imported',
          type: 'movie',
          imdbId,
          title: movie.title ?? 'Unknown movie',
          poster: pickPoster(movie.images),
          releaseInfo: importedTs ? formatRelativeImport(importedTs, nowMs) : formatRelativeAdded(addedTs, nowMs),
          description: compact([latestImport?.row.quality?.quality?.name, latestImport?.row.sourceTitle]),
          timestamp: importedTs,
          addedTimestamp: addedTs
        });
      } catch {
        continue;
      }
    }

      return mergeMovieItems([...queueItems, ...importItems]).slice(skip, skip + limit);
    } catch {
      return [];
    }
  }

  private async buildSonarrItems(skip: number, limit: number): Promise<CatalogItem[]> {
    if (!this.config.sonarr.enabled) return [];
    try {
      const nowMs = this.clock.now();
      const seriesList = await this.sonarr.listSeries().catch(() => []);
      const queue = await this.sonarr.listSeriesQueueDetails().catch(() => []);
      const historyWindow = Math.max(100, skip + limit + queue.length + seriesList.length + 25);
      const history = await this.sonarr.listRecentSeriesImports(historyWindow, 0).catch(() => []);

    const bySeriesId = new Map<number, SonarrSeriesRecord>();
    for (const series of seriesList) {
      if (series.id != null) bySeriesId.set(series.id, series);
    }

    const queueItems: CatalogItem[] = [];
    for (const row of queue) {
      try {
        const series = row.seriesId != null ? bySeriesId.get(row.seriesId) : undefined;
        const imdbId = normalizeImdbId(series?.imdbId ?? row.series?.imdbId);
        if (!imdbId) continue;

        const etaSeconds = parseEtaSeconds(row.timeleft) ?? (row.estimatedCompletionTime ? Math.max(0, Math.round((toTimestamp(row.estimatedCompletionTime) - nowMs) / 1000)) : undefined);
        const stalled = /stalled/i.test(`${row.trackedDownloadStatus ?? ''} ${row.trackedDownloadState ?? ''} ${row.status ?? ''}`) || /stalled/i.test(firstMessage(row.statusMessages) ?? '');
        const progressPct = progressFromSizes(row.size, row.sizeleft);
        const ep = episodeLabel(row.seasonNumber, row.episodeNumber);

        queueItems.push({
          source: 'sonarr',
          status: 'downloading',
          type: 'series',
          imdbId,
          title: series?.title ?? row.series?.title ?? row.title ?? 'Unknown series',
          poster: pickPoster(series?.images),
          releaseInfo: downloadingReleaseInfo(progressPct, etaSeconds, stalled),
          description: compact([ep || undefined, row.quality?.quality?.name, stalled ? firstMessage(row.statusMessages) : undefined]),
          timestamp: nowMs,
          progressPct,
          etaSeconds,
          stalled,
          seasonNumber: row.seasonNumber,
          episodeNumber: row.episodeNumber
        });
      } catch {
        continue;
      }
    }

    const latestImportBySeriesId = new Map<number, { timestamp: number; row: SonarrHistoryRecord }>();
    for (const row of history) {
      if (row.seriesId == null) continue;
      const ts = toTimestamp(row.date);
      if (!ts) continue;
      const existing = latestImportBySeriesId.get(row.seriesId);
      if (!existing || ts > existing.timestamp) {
        latestImportBySeriesId.set(row.seriesId, { timestamp: ts, row });
      }
    }

    const importItems: CatalogItem[] = [];
    for (const series of seriesList) {
      try {
        const imdbId = normalizeImdbId(series.imdbId);
        if (!imdbId) continue;

        const latestImport = latestImportBySeriesId.get(series.id);
        const importedTs = latestImport?.timestamp ?? 0;
        const addedTs = toTimestamp(series.added);
        const ep = episodeLabel(latestImport?.row.episode?.seasonNumber, latestImport?.row.episode?.episodeNumber);
        importItems.push({
          source: 'sonarr',
          status: 'imported',
          type: 'series',
          imdbId,
          title: series.title ?? 'Unknown series',
          poster: pickPoster(series.images),
          releaseInfo: importedTs ? formatRelativeImport(importedTs, nowMs) : formatRelativeAdded(addedTs, nowMs),
          description: compact([ep ? `Latest: ${ep}` : undefined, latestImport?.row.quality?.quality?.name, latestImport?.row.sourceTitle]),
          timestamp: importedTs,
          addedTimestamp: addedTs,
          seasonNumber: latestImport?.row.episode?.seasonNumber,
          episodeNumber: latestImport?.row.episode?.episodeNumber
        });
      } catch {
        continue;
      }
    }

      return mergeSeriesItems([...queueItems, ...importItems]).slice(skip, skip + limit);
    } catch {
      return [];
    }
  }
}
