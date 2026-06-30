import { TtlCache } from '../lib/cache.js';

const TMDB_DEFAULT_API_BASE_URL = 'https://api.themoviedb.org';
const DEFAULT_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface TmdbLookup {
  getMovieReleaseDate(imdbId: string): Promise<string | undefined>;
  getEpisodeReleaseDate(imdbId: string, season?: number, episode?: number): Promise<string | undefined>;
  getMovieTmdbId(imdbId: string): Promise<number | undefined>;
}

type CachedDate = { value: string | undefined };

interface TmdbFindResponse {
  movie_results?: Array<{ id?: number; release_date?: string }>;
  tv_results?: Array<{ id?: number }>;
}

interface TmdbMovieReleaseDatesResponse {
  results?: TmdbMovieReleaseCountry[];
}

interface TmdbMovieReleaseCountry {
    iso_3166_1?: string;
    release_dates?: Array<{ release_date?: string; type?: number }>;
}

interface TmdbEpisodeDetailsResponse {
  air_date?: string;
}

export class TmdbApiLookup implements TmdbLookup {
  private readonly cache = new TtlCache<CachedDate>(CACHE_TTL_MS);

  constructor(
    private readonly authToken: string,
    private readonly apiBaseUrl = TMDB_DEFAULT_API_BASE_URL,
    private readonly region = 'US'
  ) {}

  async getMovieTmdbId(imdbId: string): Promise<number | undefined> {
    const find = await this.apiGet<TmdbFindResponse>(`/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`);
    return find?.movie_results?.find((row) => typeof row.id === 'number')?.id;
  }

  async getMovieReleaseDate(imdbId: string): Promise<string | undefined> {
    const key = `movie:${imdbId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.value;

    const find = await this.apiGet<TmdbFindResponse>(`/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`);
    const movie = find?.movie_results?.find((row) => typeof row.id === 'number');
    if (!movie?.id) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }

    const releaseDates = await this.apiGet<TmdbMovieReleaseDatesResponse>(`/3/movie/${movie.id}/release_dates`);
    const usOrFirst = this.pickPreferredCountry(releaseDates?.results ?? []);
    const byType = usOrFirst?.release_dates ?? [];
    const release = this.pickEarliestDate(movie.release_date, ...this.pickDatesByType(byType, 4, 5));
    const inCinema = this.pickEarliestDate(...this.pickDatesByType(byType, 2, 3, 1));
    const resolved = release ?? inCinema;

    this.cache.set(key, { value: resolved });
    return resolved;
  }

  async getEpisodeReleaseDate(imdbId: string, season?: number, episode?: number): Promise<string | undefined> {
    const key = `episode:${imdbId}:${season ?? ''}:${episode ?? ''}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.value;

    if (season == null || episode == null) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }

    const find = await this.apiGet<TmdbFindResponse>(`/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`);
    const show = find?.tv_results?.find((row) => typeof row.id === 'number');
    if (!show?.id) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }

    const details = await this.apiGet<TmdbEpisodeDetailsResponse>(
      `/3/tv/${show.id}/season/${season}/episode/${episode}`
    );
    const date = this.normalizeDate(details?.air_date);
    this.cache.set(key, { value: date });
    return date;
  }

  private pickPreferredCountry(items: TmdbMovieReleaseCountry[]): TmdbMovieReleaseCountry | undefined {
    return items?.find((row) => row.iso_3166_1 === this.region) ?? items?.find((row) => (row.release_dates?.length ?? 0) > 0);
  }

  private pickDatesByType(items: Array<{ release_date?: string; type?: number }>, ...types: number[]): string[] {
    const valid = new Set(types);
    return items
      .filter((row) => row.type != null && valid.has(row.type))
      .map((row) => row.release_date)
      .filter((value): value is string => Boolean(this.normalizeDate(value)));
  }

  private pickEarliestDate(...dates: Array<string | undefined>): string | undefined {
    let winner: string | undefined;
    for (const raw of dates) {
      const normalized = this.normalizeDate(raw);
      if (!normalized) continue;
      if (!winner || Date.parse(normalized) < Date.parse(winner)) {
        winner = normalized;
      }
    }
    return winner;
  }

  private normalizeDate(value?: string): string | undefined {
    if (!value) return undefined;
    const asYmd = value.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asYmd)) return undefined;
    const parsed = Date.parse(`${asYmd}T00:00:00Z`);
    if (!Number.isFinite(parsed)) return undefined;
    const year = Number(asYmd.slice(0, 4));
    if (!Number.isFinite(year) || year <= 1901) return undefined;
    return asYmd;
  }

  private async apiGet<T>(path: string): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(`${this.apiBaseUrl}${path}`, {
        signal: controller.signal,
        headers: {
          Authorization: this.authToken.startsWith('Bearer ') ? this.authToken : `Bearer ${this.authToken}`
        }
      });
      if (!response.ok) return null;
      return await response.json() as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
