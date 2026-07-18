import { TtlCache } from '../lib/cache.js';
import { traktApiHeaders, traktJsonRequest } from './trakt-auth.js';

const DEFAULT_API_BASE_URL = 'https://api.trakt.tv';
const DEFAULT_TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface TraktLookup {
  getMovieReleaseDate(imdbId: string): Promise<string | undefined>;
  getEpisodeReleaseDate(imdbId: string, season?: number, episode?: number): Promise<string | undefined>;
}

type CachedDate = { value: string | undefined };

interface TraktSearchResult {
  type?: string;
  movie?: { released?: string };
  show?: { ids?: { slug?: string } };
}

export class NoopTraktLookup implements TraktLookup {
  async getMovieReleaseDate(_imdbId: string): Promise<undefined> {
    return undefined;
  }

  async getEpisodeReleaseDate(_imdbId: string, _season?: number, _episode?: number): Promise<undefined> {
    return undefined;
  }
}

/**
 * Release-date lookup through documented Trakt API methods.
 * Public lookup needs the application client ID but no user bearer token.
 */
export class TraktApiLookup implements TraktLookup {
  private readonly cache = new TtlCache<CachedDate>(CACHE_TTL_MS);
  private readonly apiBaseUrl: string;
  private readonly userAgent: string;

  constructor(
    private readonly clientId: string,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    appVersion = 'unknown'
  ) {
    this.apiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
    this.userAgent = `stremio-addarr/${appVersion}`;
  }

  async getMovieReleaseDate(imdbId: string): Promise<string | undefined> {
    const key = `movie:${imdbId}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.value;

    const results = await this.apiGet<TraktSearchResult[]>(`/search/imdb/${encodeURIComponent(imdbId)}?type=movie`);
    const date = (results ?? []).find((result) => result.type === 'movie')?.movie?.released;
    this.cache.set(key, { value: date });
    return date;
  }

  async getEpisodeReleaseDate(imdbId: string, season?: number, episode?: number): Promise<string | undefined> {
    const key = `episode:${imdbId}:${season ?? ''}:${episode ?? ''}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached.value;

    if (season == null || episode == null) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }

    const showResults = await this.apiGet<TraktSearchResult[]>(`/search/imdb/${encodeURIComponent(imdbId)}?type=show`);
    const slug = (showResults ?? []).find((result) => result.type === 'show')?.show?.ids?.slug;
    if (!slug) {
      this.cache.set(key, { value: undefined });
      return undefined;
    }

    const result = await this.apiGet<{ first_aired?: string }>(
      `/shows/${encodeURIComponent(slug)}/seasons/${season}/episodes/${episode}?extended=full`
    );
    const date = result?.first_aired ? result.first_aired.slice(0, 10) : undefined;
    this.cache.set(key, { value: date });
    return date;
  }

  private async apiGet<T>(requestPath: string): Promise<T | null> {
    try {
      return await traktJsonRequest<T>(
        `${this.apiBaseUrl}${requestPath}`,
        {
          method: 'GET',
          headers: traktApiHeaders(this.clientId, this.userAgent)
        },
        {
          timeoutMs: DEFAULT_TIMEOUT_MS,
          maxAttempts: 2
        }
      );
    } catch {
      return null;
    }
  }
}
