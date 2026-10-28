import { and, asc, desc, eq, gt, inArray, isNull, lte, notExists, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { episodes, plays, seasons, titles } from "./db/schema";
import { AppError } from "./errors";

async function requireMovie(movieId: string) {
  const db = getDb();
  const [movie] = await db
    .select({ id: titles.id })
    .from(titles)
    .where(and(eq(titles.id, movieId), eq(titles.kind, "movie")));
  if (!movie) throw new AppError("missing");
}

async function requireEpisode(episodeId: string) {
  const db = getDb();
  const [episode] = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.id, episodeId));
  if (!episode) throw new AppError("missing");
}

export async function logMovie(userId: string, movieId: string, watchedAt: Date) {
  await requireMovie(movieId);
  const db = getDb();
  const [row] = await db
    .insert(plays)
    .values({
      userId,
      movieId,
      watchedAt,
      source: "manual",
      rewatch: false,
    })
    .returning({ id: plays.id });
  if (!row) throw new AppError("fields");
  return row;
}

export async function logEpisode(userId: string, episodeId: string, watchedAt: Date) {
  await requireEpisode(episodeId);
  const db = getDb();
  const [row] = await db
    .insert(plays)
    .values({
      userId,
      episodeId,
      watchedAt,
      source: "manual",
      rewatch: false,
    })
    .returning({ id: plays.id });
  if (!row) throw new AppError("fields");
  return row;
}

export async function logSeason(userId: string, seasonId: string, watchedAt: Date) {
  const db = getDb();
  const [season] = await db.select().from(seasons).where(eq(seasons.id, seasonId));
  if (!season) throw new AppError("missing");
  if (season.seasonNumber === 0) return { inserted: 0 };
  const episodeRows = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.seasonId, seasonId));
  if (episodeRows.length === 0) return { inserted: 0 };
  const existing = await db
    .select({ episodeId: plays.episodeId })
    .from(plays)
    .where(
      and(
        eq(plays.userId, userId),
        inArray(
          plays.episodeId,
          episodeRows.map((episode) => episode.id),
        ),
      ),
    );
  const have = new Set(existing.map((row) => row.episodeId));
  const missing = episodeRows.filter((episode) => !have.has(episode.id));
  if (missing.length === 0) return { inserted: 0 };
  await db.insert(plays).values(
    missing.map((episode) => ({
      userId,
      episodeId: episode.id,
      watchedAt,
      source: "bulk" as const,
      rewatch: false,
    })),
  );
  return { inserted: missing.length };
}

export async function clearManualEpisodePlays(userId: string, episodeId: string) {
  const db = getDb();
  const removed = await db
    .delete(plays)
    .where(and(eq(plays.userId, userId), eq(plays.episodeId, episodeId), inArray(plays.source, ["manual", "bulk"])))
    .returning({ id: plays.id });
  return removed.length;
}

export async function removePlay(userId: string, playId: string) {
  const db = getDb();
  const removed = await db
    .delete(plays)
    .where(and(eq(plays.id, playId), eq(plays.userId, userId)))
    .returning({ id: plays.id });
  return removed.length > 0;
}

export async function nextEpisode(userId: string, showId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      id: episodes.id,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      name: episodes.name,
      airDate: episodes.airDate,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.showId, showId),
        gt(episodes.seasonNumber, 0),
        or(isNull(episodes.airDate), lte(episodes.airDate, sql`current_date`)),
        notExists(
          db
            .select({ id: plays.id })
            .from(plays)
            .where(and(eq(plays.episodeId, episodes.id), eq(plays.userId, userId))),
        ),
      ),
    )
    .orderBy(asc(episodes.seasonNumber), asc(episodes.episodeNumber))
    .limit(1);
  return row ?? null;
}

export async function latestEpisodePlay(userId: string, showId: string) {
  const db = getDb();
  const [row] = await db
    .select({
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
    })
    .from(plays)
    .innerJoin(episodes, eq(plays.episodeId, episodes.id))
    .where(and(eq(plays.userId, userId), eq(episodes.showId, showId)))
    .orderBy(desc(plays.watchedAt))
    .limit(1);
  return row ?? null;
}

export async function episodePlayCounts(userId: string, showId: string) {
  const db = getDb();
  const rows = await db
    .select({ episodeId: plays.episodeId, source: plays.source })
    .from(plays)
    .innerJoin(episodes, eq(plays.episodeId, episodes.id))
    .where(and(eq(plays.userId, userId), eq(episodes.showId, showId)));
  const counts = new Map<string, { manual: number; locked: number }>();
  for (const row of rows) {
    if (!row.episodeId) continue;
    const current = counts.get(row.episodeId) ?? { manual: 0, locked: 0 };
    if (row.source === "manual" || row.source === "bulk") current.manual += 1;
    else current.locked += 1;
    counts.set(row.episodeId, current);
  }
  return counts;
}

export type HistoryEntry = {
  id: string;
  watchedAt: Date;
  source: string;
  movie: { id: string; name: string; year: number | null } | null;
  episode: {
    id: string;
    name: string;
    seasonNumber: number;
    episodeNumber: number;
    showId: string;
    showName: string;
  } | null;
};

export async function listHistory(userId: string, limit = 200): Promise<HistoryEntry[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: plays.id,
      watchedAt: plays.watchedAt,
      source: plays.source,
      movieId: titles.id,
      movieName: titles.name,
      movieYear: titles.year,
      episodeId: episodes.id,
      episodeName: episodes.name,
      seasonNumber: episodes.seasonNumber,
      episodeNumber: episodes.episodeNumber,
      showId: episodes.showId,
    })
    .from(plays)
    .leftJoin(titles, eq(plays.movieId, titles.id))
    .leftJoin(episodes, eq(plays.episodeId, episodes.id))
    .where(eq(plays.userId, userId))
    .orderBy(desc(plays.watchedAt))
    .limit(limit);

  const showIds = [...new Set(rows.map((row) => row.showId).filter((id): id is string => Boolean(id)))];
  const showRows =
    showIds.length === 0
      ? []
      : await db.select({ id: titles.id, name: titles.name }).from(titles).where(inArray(titles.id, showIds));
  const showNames = new Map(showRows.map((row) => [row.id, row.name]));

  return rows.map((row) => ({
    id: row.id,
    watchedAt: row.watchedAt,
    source: row.source,
    movie: row.movieId && row.movieName ? { id: row.movieId, name: row.movieName, year: row.movieYear } : null,
    episode:
      row.episodeId && row.episodeName && row.seasonNumber !== null && row.episodeNumber !== null && row.showId
        ? {
            id: row.episodeId,
            name: row.episodeName,
            seasonNumber: row.seasonNumber,
            episodeNumber: row.episodeNumber,
            showId: row.showId,
            showName: showNames.get(row.showId) ?? "Show",
          }
        : null,
  }));
}

export async function getPlayForUser(userId: string, playId: string) {
  const db = getDb();
  const [row] = await db.select().from(plays).where(and(eq(plays.id, playId), eq(plays.userId, userId)));
  return row ?? null;
}

export async function listMoviePlays(userId: string, movieId: string) {
  const db = getDb();
  return db
    .select({ id: plays.id, watchedAt: plays.watchedAt, source: plays.source })
    .from(plays)
    .where(and(eq(plays.userId, userId), eq(plays.movieId, movieId)))
    .orderBy(desc(plays.watchedAt));
}
