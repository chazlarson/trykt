import { z } from "zod";

const TMDB_ORIGIN = "https://api.themoviedb.org";

export class TmdbError extends Error {
  constructor(
    readonly code: "missing_key" | "rate_limited" | "timeout" | "http",
    message: string,
  ) {
    super(message);
    this.name = "TmdbError";
  }
}

export type MappedTitle = {
  kind: "movie" | "show";
  tmdbId: number;
  imdbId: string | null;
  name: string;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  runtimeMin: number | null;
  status: string | null;
};

export type MappedSeasonIndex = {
  tmdbId: number;
  seasonNumber: number;
  name: string;
};

export type MappedEpisode = {
  tmdbId: number;
  episodeNumber: number;
  name: string;
  overview: string | null;
  airDate: string | null;
  runtimeMin: number | null;
  stillPath: string | null;
};

export type MappedSeason = {
  tmdbId: number;
  seasonNumber: number;
  name: string;
  episodes: MappedEpisode[];
};

type Limiter = {
  take: () => Promise<void>;
};

function readLimit(): { limit: number; windowMs: number } {
  const limit = Number(process.env.TMDB_RATE_LIMIT ?? 30);
  const windowMs = Number(process.env.TMDB_RATE_WINDOW_MS ?? 10_000);
  return {
    limit: Number.isFinite(limit) && limit > 0 ? limit : 30,
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : 10_000,
  };
}

function createLimiter(): Limiter {
  const stamps: number[] = [];
  let chain: Promise<void> = Promise.resolve();
  return {
    take() {
      const run = chain.then(async () => {
        const { limit, windowMs } = readLimit();
        while (true) {
          const now = Date.now();
          while (stamps.length > 0 && now - stamps[0]! >= windowMs) stamps.shift();
          if (stamps.length < limit) {
            stamps.push(now);
            return;
          }
          const wait = windowMs - (now - stamps[0]!) + 25;
          await new Promise((resolve) => setTimeout(resolve, wait));
        }
      });
      chain = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
  };
}

const limiter = createLimiter();

function blankToNull(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function yearFrom(value: string | null | undefined): number | null {
  if (!value || value.length < 4) return null;
  const year = Number(value.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

function pathOrNull(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/")) return null;
  return value;
}

export function tmdbImageUrl(posterPath: string | null, size: "w185" | "w342" = "w342"): string | null {
  if (!posterPath || !posterPath.startsWith("/")) return null;
  return `https://image.tmdb.org/t/p/${size}${posterPath}`;
}

function apiKey(): string {
  const key = process.env.TMDB_API_KEY?.trim();
  if (!key) {
    throw new TmdbError("missing_key", "TMDB_API_KEY is not set.");
  }
  return key;
}

async function tmdbGet(path: string, params: Record<string, string>): Promise<unknown | null> {
  const key = apiKey();
  await limiter.take();
  const url = new URL(path, TMDB_ORIGIN);
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": "trykt",
  };
  if (key.split(".").length >= 3) {
    headers.authorization = `Bearer ${key}`;
  } else {
    url.searchParams.set("api_key", key);
  }
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);

  let response: Response;
  try {
    response = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new TmdbError("timeout", "TMDB timed out.");
    }
    throw new TmdbError("timeout", "TMDB timed out.");
  }

  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000;
    await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)));
    throw new TmdbError("rate_limited", "TMDB is rate limiting requests.");
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new TmdbError("http", `TMDB returned ${response.status}.`);
  return response.json() as Promise<unknown>;
}

const searchItem = z.object({
  media_type: z.string().optional(),
  id: z.number().int(),
  title: z.string().optional(),
  name: z.string().optional(),
  release_date: z.string().nullable().optional(),
  first_air_date: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
});

const searchPayload = z.object({
  results: z.array(searchItem).optional(),
});

const moviePayload = z.object({
  id: z.number().int(),
  imdb_id: z.string().nullable().optional(),
  title: z.string(),
  release_date: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  runtime: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
});

const showPayload = z.object({
  id: z.number().int(),
  name: z.string(),
  first_air_date: z.string().nullable().optional(),
  overview: z.string().nullable().optional(),
  poster_path: z.string().nullable().optional(),
  backdrop_path: z.string().nullable().optional(),
  episode_run_time: z.array(z.number()).nullable().optional(),
  status: z.string().nullable().optional(),
  seasons: z
    .array(
      z.object({
        id: z.number().int(),
        season_number: z.number().int(),
        name: z.string().nullable().optional(),
      }),
    )
    .optional(),
  external_ids: z
    .object({
      imdb_id: z.string().nullable().optional(),
    })
    .optional(),
});

const seasonPayload = z.object({
  id: z.number().int(),
  season_number: z.number().int(),
  name: z.string().nullable().optional(),
  episodes: z.array(
    z.object({
      id: z.number().int(),
      episode_number: z.number().int(),
      name: z.string().nullable().optional(),
      overview: z.string().nullable().optional(),
      air_date: z.string().nullable().optional(),
      runtime: z.number().nullable().optional(),
      still_path: z.string().nullable().optional(),
    }),
  ),
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new TmdbError("http", "TMDB returned an unexpected payload.");
  return parsed.data;
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

export async function searchTitles(query: string): Promise<MappedTitle[]> {
  const payload = parse(searchPayload, await tmdbGet("/3/search/multi", { query, include_adult: "false" }));
  const mapped: MappedTitle[] = [];
  for (const item of payload.results ?? []) {
    if (item.media_type !== "movie" && item.media_type !== "tv") continue;
    const kind = item.media_type === "movie" ? "movie" : "show";
    const name = kind === "movie" ? item.title : item.name;
    if (!name || !name.trim()) continue;
    const dated = kind === "movie" ? item.release_date : item.first_air_date;
    mapped.push({
      kind,
      tmdbId: item.id,
      imdbId: null,
      name: name.trim(),
      year: yearFrom(dated),
      overview: blankToNull(item.overview),
      posterPath: pathOrNull(item.poster_path),
      backdropPath: pathOrNull(item.backdrop_path),
      runtimeMin: null,
      status: null,
    });
  }
  return mapped;
}

export async function fetchMovie(tmdbId: number): Promise<MappedTitle | null> {
  const raw = await tmdbGet(`/3/movie/${tmdbId}`, {});
  if (raw === null) return null;
  const movie = parse(moviePayload, raw);
  return {
    kind: "movie",
    tmdbId: movie.id,
    imdbId: blankToNull(movie.imdb_id),
    name: movie.title.trim(),
    year: yearFrom(movie.release_date),
    overview: blankToNull(movie.overview),
    posterPath: pathOrNull(movie.poster_path),
    backdropPath: pathOrNull(movie.backdrop_path),
    runtimeMin: movie.runtime ?? null,
    status: blankToNull(movie.status),
  };
}

export async function fetchShow(tmdbId: number): Promise<{ title: MappedTitle; seasons: MappedSeasonIndex[] } | null> {
  const raw = await tmdbGet(`/3/tv/${tmdbId}`, { append_to_response: "external_ids" });
  if (raw === null) return null;
  const show = parse(showPayload, raw);
  return {
    title: {
      kind: "show",
      tmdbId: show.id,
      imdbId: blankToNull(show.external_ids?.imdb_id),
      name: show.name.trim(),
      year: yearFrom(show.first_air_date),
      overview: blankToNull(show.overview),
      posterPath: pathOrNull(show.poster_path),
      backdropPath: pathOrNull(show.backdrop_path),
      runtimeMin: show.episode_run_time?.[0] ?? null,
      status: blankToNull(show.status),
    },
    seasons: (show.seasons ?? []).map((season) => ({
      tmdbId: season.id,
      seasonNumber: season.season_number,
      name: blankToNull(season.name) ?? `Season ${season.season_number}`,
    })),
  };
}

const findPayload = z.object({
  movie_results: z.array(z.object({ id: z.number().int() })).optional(),
  tv_results: z.array(z.object({ id: z.number().int() })).optional(),
  tv_episode_results: z
    .array(
      z.object({
        id: z.number().int(),
        show_id: z.number().int(),
        season_number: z.number().int(),
        episode_number: z.number().int(),
      }),
    )
    .optional(),
  tv_season_results: z
    .array(
      z.object({
        id: z.number().int(),
        show_id: z.number().int(),
        season_number: z.number().int(),
      }),
    )
    .optional(),
});

export type ImdbFind = {
  movieTmdbId: number | null;
  showTmdbId: number | null;
  episode: { showTmdbId: number; seasonNumber: number; episodeNumber: number } | null;
  season: { showTmdbId: number; seasonNumber: number } | null;
};

export async function findByImdb(imdbId: string): Promise<ImdbFind | null> {
  if (!/^tt\d{5,12}$/.test(imdbId)) return null;
  const raw = await tmdbGet(`/3/find/${imdbId}`, { external_source: "imdb_id" });
  if (raw === null) return null;
  const found = parse(findPayload, raw);
  const movie = found.movie_results?.[0];
  const show = found.tv_results?.[0];
  const episode = found.tv_episode_results?.[0];
  const season = found.tv_season_results?.[0];
  if (!movie && !show && !episode && !season) return null;
  return {
    movieTmdbId: movie?.id ?? null,
    showTmdbId: show?.id ?? episode?.show_id ?? season?.show_id ?? null,
    episode: episode
      ? {
          showTmdbId: episode.show_id,
          seasonNumber: episode.season_number,
          episodeNumber: episode.episode_number,
        }
      : null,
    season: season ? { showTmdbId: season.show_id, seasonNumber: season.season_number } : null,
  };
}

export async function fetchSeason(showTmdbId: number, seasonNumber: number): Promise<MappedSeason | null> {
  const raw = await tmdbGet(`/3/tv/${showTmdbId}/season/${seasonNumber}`, {});
  if (raw === null) return null;
  const season = parse(seasonPayload, raw);
  return {
    tmdbId: season.id,
    seasonNumber: season.season_number,
    name: blankToNull(season.name) ?? `Season ${season.season_number}`,
    episodes: season.episodes.map((episode) => ({
      tmdbId: episode.id,
      episodeNumber: episode.episode_number,
      name: blankToNull(episode.name) ?? `Episode ${episode.episode_number}`,
      overview: blankToNull(episode.overview),
      airDate: blankToNull(episode.air_date),
      runtimeMin: episode.runtime ?? null,
      stillPath: pathOrNull(episode.still_path),
    })),
  };
}
