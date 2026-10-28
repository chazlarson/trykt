import { and, asc, eq, sql } from "drizzle-orm";
import type { NoticeCode } from "../copy";
import { getDb } from "../db";
import { episodes, searchCache, seasons, titles, type SearchHit } from "../db/schema";
import { takeToken, TMDB_USER_LIMIT, TMDB_USER_WINDOW_SECONDS } from "../rate-limit";
import {
  fetchMovie,
  fetchSeason,
  fetchShow,
  normalizeQuery,
  searchTitles,
  TmdbError,
  type MappedTitle,
} from "./tmdb";
import { DETAIL_TTL_MS, episodeTtlMs, isFresh, SEARCH_TTL_MS, withinMaxCache } from "./windows";

export type CatalogTitle = {
  id: string;
  kind: "movie" | "show";
  tmdbId: number;
  name: string;
  year: number | null;
  overview: string | null;
  posterPath: string | null;
  runtimeMin: number | null;
  status: string | null;
  unavailableAt: Date | null;
};

export type ShowEpisode = {
  id: string;
  episodeNumber: number;
  name: string;
  overview: string | null;
  airDate: string | null;
  runtimeMin: number | null;
};

export type ShowSeason = {
  id: string;
  seasonNumber: number;
  name: string;
  episodes: ShowEpisode[];
};

export type ShowPage = {
  show: CatalogTitle;
  seasons: ShowSeason[];
  notice: NoticeCode | null;
};

function noticeFor(error: TmdbError): NoticeCode {
  if (error.code === "missing_key") return "tmdb-missing";
  if (error.code === "rate_limited") return "tmdb-limit";
  if (error.code === "timeout") return "tmdb";
  return "tmdb-error";
}

function toCatalog(row: typeof titles.$inferSelect): CatalogTitle {
  return {
    id: row.id,
    kind: row.kind === "show" ? "show" : "movie",
    tmdbId: row.tmdbId,
    name: row.name,
    year: row.year,
    overview: row.overview,
    posterPath: row.posterPath,
    runtimeMin: row.runtimeMin,
    status: row.status,
    unavailableAt: row.unavailableAt,
  };
}

async function allowUserFetch(userId: string | null): Promise<boolean> {
  if (!userId) return true;
  return takeToken(`tmdb:user:${userId}`, TMDB_USER_WINDOW_SECONDS, TMDB_USER_LIMIT);
}

async function upsertSearchHit(item: MappedTitle): Promise<CatalogTitle> {
  const db = getDb();
  const [row] = await db
    .insert(titles)
    .values({
      kind: item.kind,
      tmdbId: item.tmdbId,
      name: item.name,
      year: item.year,
      overview: item.overview,
      posterPath: item.posterPath,
      backdropPath: item.backdropPath,
    })
    .onConflictDoUpdate({
      target: [titles.kind, titles.tmdbId],
      set: {
        name: sql`excluded.name`,
        year: sql`excluded.year`,
        overview: sql`coalesce(${titles.overview}, excluded.overview)`,
        posterPath: sql`coalesce(excluded.poster_path, ${titles.posterPath})`,
        backdropPath: sql`coalesce(excluded.backdrop_path, ${titles.backdropPath})`,
      },
    })
    .returning();
  if (!row) throw new Error("Could not save the catalog row.");
  return toCatalog(row);
}

async function upsertDetail(item: MappedTitle) {
  const db = getDb();
  const [row] = await db
    .insert(titles)
    .values({
      kind: item.kind,
      tmdbId: item.tmdbId,
      imdbId: item.imdbId,
      name: item.name,
      year: item.year,
      overview: item.overview,
      posterPath: item.posterPath,
      backdropPath: item.backdropPath,
      runtimeMin: item.runtimeMin,
      status: item.status,
      fetchedAt: new Date(),
      unavailableAt: null,
    })
    .onConflictDoUpdate({
      target: [titles.kind, titles.tmdbId],
      set: {
        imdbId: item.imdbId,
        name: item.name,
        year: item.year,
        overview: item.overview,
        posterPath: item.posterPath,
        backdropPath: item.backdropPath,
        runtimeMin: item.runtimeMin,
        status: item.status,
        fetchedAt: new Date(),
        unavailableAt: null,
      },
    })
    .returning();
  if (!row) throw new Error("Could not save the catalog row.");
  return row;
}

async function titlesForHits(hits: SearchHit[]): Promise<CatalogTitle[]> {
  const db = getDb();
  const rows: CatalogTitle[] = [];
  for (const hit of hits) {
    const [row] = await db
      .select()
      .from(titles)
      .where(and(eq(titles.kind, hit.kind), eq(titles.tmdbId, hit.tmdbId)));
    if (row) rows.push(toCatalog(row));
  }
  return rows;
}

export async function searchCatalog(userId: string, rawQuery: string): Promise<{ results: CatalogTitle[]; notice: NoticeCode | null }> {
  const query = normalizeQuery(rawQuery);
  if (!query) return { results: [], notice: null };
  const db = getDb();
  const [cached] = await db.select().from(searchCache).where(eq(searchCache.query, query));
  if (cached && isFresh(cached.fetchedAt, SEARCH_TTL_MS)) {
    return { results: await titlesForHits(cached.hits), notice: null };
  }
  if (!(await allowUserFetch(userId))) {
    if (cached && withinMaxCache(cached.fetchedAt)) {
      return { results: await titlesForHits(cached.hits), notice: "stale" };
    }
    return { results: [], notice: "search-rate" };
  }
  try {
    const mapped = await searchTitles(query);
    const results: CatalogTitle[] = [];
    for (const item of mapped) results.push(await upsertSearchHit(item));
    const hits = mapped.map((item) => ({ kind: item.kind, tmdbId: item.tmdbId }));
    await db
      .insert(searchCache)
      .values({ query, fetchedAt: new Date(), hits })
      .onConflictDoUpdate({
        target: searchCache.query,
        set: { fetchedAt: new Date(), hits },
      });
    return { results, notice: null };
  } catch (error) {
    if (error instanceof TmdbError) {
      if (cached && withinMaxCache(cached.fetchedAt)) {
        return { results: await titlesForHits(cached.hits), notice: "stale" };
      }
      return { results: [], notice: noticeFor(error) };
    }
    throw error;
  }
}

async function markUnavailable(id: string) {
  const db = getDb();
  await db.update(titles).set({ unavailableAt: new Date() }).where(eq(titles.id, id));
}

async function loadTitle(id: string, kind: "movie" | "show") {
  const db = getDb();
  const [row] = await db.select().from(titles).where(and(eq(titles.id, id), eq(titles.kind, kind)));
  return row ?? null;
}

export async function openMovie(userId: string | null, id: string): Promise<{ movie: CatalogTitle; notice: NoticeCode | null } | null> {
  const row = await loadTitle(id, "movie");
  if (!row) return null;
  if (isFresh(row.fetchedAt, DETAIL_TTL_MS)) return { movie: toCatalog(row), notice: null };
  if (!(await allowUserFetch(userId))) {
    return { movie: toCatalog(row), notice: row.fetchedAt ? "stale" : "search-rate" };
  }
  try {
    const detail = await fetchMovie(row.tmdbId);
    if (!detail) {
      await markUnavailable(row.id);
    } else {
      await upsertDetail(detail);
    }
  } catch (error) {
    if (!(error instanceof TmdbError)) throw error;
    const current = await loadTitle(id, "movie");
    return {
      movie: toCatalog(current ?? row),
      notice: error.code === "missing_key" ? "tmdb-missing" : current?.fetchedAt ? "stale" : noticeFor(error),
    };
  }
  const fresh = await loadTitle(id, "movie");
  return { movie: toCatalog(fresh ?? row), notice: null };
}

async function syncSeasonIndex(showId: string, index: { tmdbId: number; seasonNumber: number; name: string }[]) {
  const db = getDb();
  for (const season of index) {
    await db
      .insert(seasons)
      .values({
        showId,
        seasonNumber: season.seasonNumber,
        tmdbId: season.tmdbId,
        name: season.name,
      })
      .onConflictDoUpdate({
        target: [seasons.showId, seasons.seasonNumber],
        set: { tmdbId: season.tmdbId, name: season.name },
      });
  }
}

async function syncEpisodes(
  showId: string,
  seasonId: string,
  seasonNumber: number,
  episodeRows: {
    tmdbId: number;
    episodeNumber: number;
    name: string;
    overview: string | null;
    airDate: string | null;
    runtimeMin: number | null;
    stillPath: string | null;
  }[],
) {
  const db = getDb();
  const fetchedAt = new Date();
  for (const episode of episodeRows) {
    await db
      .insert(episodes)
      .values({
        showId,
        seasonId,
        seasonNumber,
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

async function readShowTree(showId: string): Promise<ShowSeason[]> {
  const db = getDb();
  const seasonRows = await db.select().from(seasons).where(eq(seasons.showId, showId)).orderBy(asc(seasons.seasonNumber));
  const episodeRows = await db
    .select()
    .from(episodes)
    .where(eq(episodes.showId, showId))
    .orderBy(asc(episodes.seasonNumber), asc(episodes.episodeNumber));
  return seasonRows.map((season) => ({
    id: season.id,
    seasonNumber: season.seasonNumber,
    name: season.name,
    episodes: episodeRows
      .filter((episode) => episode.seasonId === season.id)
      .map((episode) => ({
        id: episode.id,
        episodeNumber: episode.episodeNumber,
        name: episode.name,
        overview: episode.overview,
        airDate: episode.airDate,
        runtimeMin: episode.runtimeMin,
      })),
  }));
}

export async function openShow(userId: string | null, id: string): Promise<ShowPage | null> {
  const row = await loadTitle(id, "show");
  if (!row) return null;
  const db = getDb();
  const seasonRows = await db.select().from(seasons).where(eq(seasons.showId, row.id));
  const ttl = episodeTtlMs(row.status);
  const episodesStale = seasonRows.length === 0 || seasonRows.some((season) => !isFresh(season.fetchedAt, ttl));
  const detailStale = !isFresh(row.fetchedAt, DETAIL_TTL_MS);
  let notice: NoticeCode | null = null;
  if (detailStale || episodesStale) {
    if (!(await allowUserFetch(userId))) {
      notice = row.fetchedAt || seasonRows.length > 0 ? "stale" : "search-rate";
    } else {
      try {
        const detail = await fetchShow(row.tmdbId);
        if (!detail) {
          await markUnavailable(row.id);
        } else {
          await upsertDetail(detail.title);
          await syncSeasonIndex(row.id, detail.seasons);
        }
        const current = (await loadTitle(id, "show")) ?? row;
        const freshSeasons = await db.select().from(seasons).where(eq(seasons.showId, row.id));
        const freshTtl = episodeTtlMs(current.status);
        for (const season of freshSeasons) {
          if (isFresh(season.fetchedAt, freshTtl)) continue;
          const full = await fetchSeason(current.tmdbId, season.seasonNumber);
          if (!full) continue;
          await syncEpisodes(row.id, season.id, season.seasonNumber, full.episodes);
          if (full.name !== season.name || full.tmdbId !== season.tmdbId) {
            await db
              .update(seasons)
              .set({ name: full.name, tmdbId: full.tmdbId })
              .where(eq(seasons.id, season.id));
          }
        }
      } catch (error) {
        if (!(error instanceof TmdbError)) throw error;
        notice = error.code === "missing_key" ? "tmdb-missing" : row.fetchedAt || seasonRows.length > 0 ? "stale" : noticeFor(error);
      }
    }
  }
  const fresh = (await loadTitle(id, "show")) ?? row;
  return { show: toCatalog(fresh), seasons: await readShowTree(row.id), notice };
}

export async function refreshCatalogTitle(id: string) {
  const db = getDb();
  const [row] = await db.select({ kind: titles.kind }).from(titles).where(eq(titles.id, id));
  if (!row) return;
  const opened = row.kind === "movie" ? await openMovie(null, id) : await openShow(null, id);
  if (opened?.notice === "tmdb-missing") {
    throw new TmdbError("missing_key", "TMDB_API_KEY is not set.");
  }
}
