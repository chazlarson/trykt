import { and, eq } from "drizzle-orm";
import { fetchSeason, fetchShow, findByImdb, TmdbError, type ImdbFind, type MappedSeason } from "../catalog/tmdb";
import { episodeLabel } from "../copy";
import { getDb } from "../db";
import { episodes, seasons, titles } from "../db/schema";
import type { Hint, Ids } from "./parser";

export type Match = { ok: true; id: string } | { ok: false; reason: string };

export type Resolver = {
  movie(ids: Ids, hint: Hint): Promise<Match>;
  show(ids: Ids, hint: Hint): Promise<Match>;
  season(ids: Ids, seasonNumber: number, seasonTmdbId: number | null, hint: Hint): Promise<Match>;
  episode(ids: Ids, seasonNumber: number, episodeNumber: number, episodeIds: Ids, hint: Hint): Promise<Match>;
};

export function createCatalogResolver(): Resolver {
  const finds = new Map<string, Promise<ImdbFind | null>>();
  const titlesByTmdb = new Map<string, Promise<string>>();
  const seasonLoads = new Map<string, Promise<Match | { ok: true }>>();

  async function cachedFind(imdbId: string): Promise<ImdbFind | null> {
    let pending = finds.get(imdbId);
    if (!pending) {
      pending = findByImdb(imdbId);
      finds.set(imdbId, pending);
    }
    return pending;
  }

  async function movieTmdb(ids: Ids): Promise<Match & { tmdbId?: number }> {
    if (ids.tmdbId) return { ok: true, id: "", tmdbId: ids.tmdbId };
    if (!ids.imdbId) return { ok: false, reason: "No TMDB or IMDb id." };
    try {
      const found = await cachedFind(ids.imdbId);
      if (!found?.movieTmdbId) return { ok: false, reason: "IMDb id did not match a movie." };
      return { ok: true, id: "", tmdbId: found.movieTmdbId };
    } catch (error) {
      return { ok: false, reason: tmdbReason(error) };
    }
  }

  async function showTmdb(ids: Ids, episodeIds: Ids): Promise<{ ok: true; tmdbId: number } | { ok: false; reason: string }> {
    if (ids.tmdbId) return { ok: true, tmdbId: ids.tmdbId };
    const imdbId = ids.imdbId ?? episodeIds.imdbId;
    if (!imdbId) return { ok: false, reason: "No TMDB or IMDb id." };
    try {
      const found = await cachedFind(imdbId);
      const tmdbId = found?.showTmdbId ?? found?.episode?.showTmdbId ?? null;
      if (!tmdbId) return { ok: false, reason: "IMDb id did not match a show." };
      return { ok: true, tmdbId };
    } catch (error) {
      return { ok: false, reason: tmdbReason(error) };
    }
  }

  return {
    async movie(ids, hint) {
      const resolved = await movieTmdb(ids);
      if (!resolved.ok || !resolved.tmdbId) return resolved.ok ? { ok: false, reason: "No TMDB or IMDb id." } : resolved;
      const id = await ensureTitle("movie", resolved.tmdbId, ids.imdbId, hint, titlesByTmdb);
      return { ok: true, id };
    },
    async show(ids, hint) {
      const resolved = await showTmdb(ids, { tmdbId: null, imdbId: null });
      if (!resolved.ok) return resolved;
      const id = await ensureTitle("show", resolved.tmdbId, ids.imdbId, hint, titlesByTmdb);
      return { ok: true, id };
    },
    async season(ids, seasonNumber, seasonTmdbId, hint) {
      const resolved = await showTmdb(ids, { tmdbId: null, imdbId: null });
      if (!resolved.ok) return resolved;
      const showId = await ensureTitle("show", resolved.tmdbId, ids.imdbId, hint, titlesByTmdb);
      const existing = await findSeason(showId, seasonNumber);
      if (existing) return { ok: true, id: existing };
      if (seasonTmdbId) {
        const id = await saveSeason(showId, seasonNumber, seasonTmdbId, `Season ${seasonNumber}`);
        return { ok: true, id };
      }
      try {
        const detail = await fetchShow(resolved.tmdbId);
        const season = detail?.seasons.find((item) => item.seasonNumber === seasonNumber);
        if (!season) return { ok: false, reason: `No season ${seasonNumber} on that show.` };
        const id = await saveSeason(showId, season.seasonNumber, season.tmdbId, season.name);
        return { ok: true, id };
      } catch (error) {
        return { ok: false, reason: tmdbReason(error) };
      }
    },
    async episode(ids, seasonNumber, episodeNumber, episodeIds, hint) {
      const resolved = await showTmdb(ids, episodeIds);
      if (!resolved.ok) return resolved;
      const showId = await ensureTitle("show", resolved.tmdbId, ids.imdbId, hint, titlesByTmdb);
      const existing = await findEpisode(showId, seasonNumber, episodeNumber);
      if (existing) return { ok: true, id: existing };
      const loaded = await loadSeason(resolved.tmdbId, seasonNumber, showId, seasonLoads);
      if (!loaded.ok) return loaded;
      const episodeId = await findEpisode(showId, seasonNumber, episodeNumber);
      if (!episodeId) return { ok: false, reason: `No episode at ${episodeLabel(seasonNumber, episodeNumber)}.` };
      return { ok: true, id: episodeId };
    },
  };
}

function tmdbReason(error: unknown): string {
  if (error instanceof TmdbError) {
    if (error.code === "timeout") return "TMDB timed out.";
    if (error.code === "rate_limited") return "TMDB is rate limiting requests.";
    if (error.code === "missing_key") return "TMDB_API_KEY is not set.";
  }
  return "TMDB returned an error.";
}

async function ensureTitle(
  kind: "movie" | "show",
  tmdbId: number,
  imdbId: string | null,
  hint: Hint,
  cache: Map<string, Promise<string>>,
): Promise<string> {
  const key = `${kind}:${tmdbId}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = insertTitle(kind, tmdbId, imdbId, hint);
    cache.set(key, pending);
  }
  return pending;
}

async function insertTitle(kind: "movie" | "show", tmdbId: number, imdbId: string | null, hint: Hint): Promise<string> {
  const db = getDb();
  const [inserted] = await db
    .insert(titles)
    .values({
      kind,
      tmdbId,
      imdbId,
      name: hint.title || "Untitled",
      year: hint.year,
    })
    .onConflictDoNothing()
    .returning({ id: titles.id });
  if (inserted) return inserted.id;
  const [existing] = await db
    .select({ id: titles.id, imdbId: titles.imdbId })
    .from(titles)
    .where(and(eq(titles.kind, kind), eq(titles.tmdbId, tmdbId)));
  if (!existing) throw new Error("Could not save the catalog row.");
  if (!existing.imdbId && imdbId) {
    await db.update(titles).set({ imdbId }).where(eq(titles.id, existing.id));
  }
  return existing.id;
}

async function findSeason(showId: string, seasonNumber: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.showId, showId), eq(seasons.seasonNumber, seasonNumber)));
  return row?.id ?? null;
}

async function findEpisode(showId: string, seasonNumber: number, episodeNumber: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: episodes.id })
    .from(episodes)
    .where(
      and(eq(episodes.showId, showId), eq(episodes.seasonNumber, seasonNumber), eq(episodes.episodeNumber, episodeNumber)),
    );
  return row?.id ?? null;
}

async function saveSeason(showId: string, seasonNumber: number, tmdbId: number, name: string): Promise<string> {
  const [row] = await getDb()
    .insert(seasons)
    .values({ showId, seasonNumber, tmdbId, name })
    .onConflictDoUpdate({
      target: [seasons.showId, seasons.seasonNumber],
      set: { tmdbId, name },
    })
    .returning({ id: seasons.id });
  if (!row) throw new Error("Could not save the season.");
  return row.id;
}

async function loadSeason(
  showTmdbId: number,
  seasonNumber: number,
  showId: string,
  cache: Map<string, Promise<Match | { ok: true }>>,
): Promise<Match | { ok: true }> {
  const key = `${showTmdbId}:${seasonNumber}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchAndStoreSeason(showTmdbId, seasonNumber, showId);
    cache.set(key, pending);
  }
  return pending;
}

async function fetchAndStoreSeason(showTmdbId: number, seasonNumber: number, showId: string): Promise<Match | { ok: true }> {
  try {
    const season = await fetchSeason(showTmdbId, seasonNumber);
    if (!season) return { ok: false, reason: `No season ${seasonNumber} on that show.` };
    await storeSeason(showId, season);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: tmdbReason(error) };
  }
}

async function storeSeason(showId: string, season: MappedSeason) {
  const seasonId = await saveSeason(showId, season.seasonNumber, season.tmdbId, season.name);
  const db = getDb();
  const fetchedAt = new Date();
  for (const episode of season.episodes) {
    await db
      .insert(episodes)
      .values({
        showId,
        seasonId,
        seasonNumber: season.seasonNumber,
        episodeNumber: episode.episodeNumber,
        tmdbId: episode.tmdbId,
        name: episode.name,
        overview: episode.overview,
        airDate: episode.airDate,
        runtimeMin: episode.runtimeMin,
        stillPath: episode.stillPath,
        fetchedAt,
      })
      .onConflictDoUpdate({
        target: [episodes.showId, episodes.seasonNumber, episodes.episodeNumber],
        set: {
          seasonId,
          tmdbId: episode.tmdbId,
          name: episode.name,
          overview: episode.overview,
          airDate: episode.airDate,
          runtimeMin: episode.runtimeMin,
          stillPath: episode.stillPath,
          fetchedAt,
        },
      });
  }
  await db.update(seasons).set({ fetchedAt }).where(eq(seasons.id, seasonId));
}
