import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { type ImportErrorReport, listItems, lists, plays, ratings, shelfItems, watchlistItems } from "../db/schema";
import type { ParsedExport, RatingItem, TitleItem } from "./parser";
import type { Match, Resolver } from "./resolve";

const FLUSH = 200;

export async function applyImport(userId: string, parsed: ParsedExport, resolver: Resolver): Promise<ImportErrorReport> {
  const unmatched = [...parsed.unmatched];
  const counts = {
    plays: 0,
    ratings: 0,
    watchlist: 0,
    lists: 0,
    list_items: 0,
    shelf: 0,
    notes_skipped: parsed.notesSkipped,
  };
  await applyPlays(userId, parsed, resolver, unmatched, counts);
  await applyRatings(userId, parsed, resolver, unmatched, counts);
  await applyWatchlist(userId, parsed, resolver, unmatched, counts);
  await applyLists(userId, parsed, resolver, unmatched, counts);
  await applyShelf(userId, parsed, resolver, unmatched, counts);
  return {
    parser: "import_v1",
    failure: null,
    unmatched,
    counts,
    files: parsed.files,
  };
}

async function applyPlays(
  userId: string,
  parsed: ParsedExport,
  resolver: Resolver,
  unmatched: ImportErrorReport["unmatched"],
  counts: ImportErrorReport["counts"],
) {
  const db = getDb();
  const existing = await db
    .select({ movieId: plays.movieId, episodeId: plays.episodeId, watchedAt: plays.watchedAt })
    .from(plays)
    .where(eq(plays.userId, userId));
  const seen = new Map<string, number[]>();
  for (const row of existing) {
    const key = row.movieId ? `movie:${row.movieId}` : row.episodeId ? `episode:${row.episodeId}` : "";
    if (!key) continue;
    const stamps = seen.get(key) ?? [];
    stamps.push(row.watchedAt.getTime());
    seen.set(key, stamps);
  }
  const pending: (typeof plays.$inferInsert)[] = [];
  const ordered = [...parsed.plays].sort((left, right) => left.watchedAt.localeCompare(right.watchedAt));
  for (const item of ordered) {
    const match =
      item.kind === "movie"
        ? await resolver.movie(item.ids, item)
        : await resolver.episode(item.ids, item.seasonNumber ?? 0, item.episodeNumber ?? 0, item.episodeIds, item);
    if (!match.ok) {
      unmatched.push({ title: item.title || "Untitled", year: item.year, reason: match.reason });
      continue;
    }
    const key = `${item.kind}:${match.id}`;
    const stamps = seen.get(key) ?? [];
    const watchedAt = new Date(item.watchedAt);
    const stamp = watchedAt.getTime();
    if (stamps.includes(stamp)) continue;
    pending.push({
      userId,
      movieId: item.kind === "movie" ? match.id : null,
      episodeId: item.kind === "episode" ? match.id : null,
      watchedAt,
      source: "import",
      rewatch: stamps.some((time) => time < stamp),
    });
    stamps.push(stamp);
    seen.set(key, stamps);
    counts.plays += 1;
    if (pending.length >= FLUSH) await flushPlays(pending);
  }
  await flushPlays(pending);
}

async function flushPlays(pending: (typeof plays.$inferInsert)[]) {
  if (pending.length === 0) return;
  await getDb().insert(plays).values(pending);
  pending.length = 0;
}

async function applyRatings(
  userId: string,
  parsed: ParsedExport,
  resolver: Resolver,
  unmatched: ImportErrorReport["unmatched"],
  counts: ImportErrorReport["counts"],
) {
  const db = getDb();
  for (const item of parsed.ratings) {
    const match = await matchRating(item, resolver);
    if (!match.ok) {
      unmatched.push({ title: item.title || "Untitled", year: item.year, reason: match.reason });
      continue;
    }
    const updatedAt = item.ratedAt ? new Date(item.ratedAt) : new Date();
    const [existing] = await db
      .select({ updatedAt: ratings.updatedAt })
      .from(ratings)
      .where(and(eq(ratings.userId, userId), eq(ratings.subjectType, item.subject), eq(ratings.subjectId, match.id)));
    if (existing && existing.updatedAt.getTime() > updatedAt.getTime()) continue;
    await db
      .insert(ratings)
      .values({ userId, subjectType: item.subject, subjectId: match.id, score: item.score, updatedAt })
      .onConflictDoUpdate({
        target: [ratings.userId, ratings.subjectType, ratings.subjectId],
        set: { score: item.score, updatedAt },
      });
    counts.ratings += 1;
  }
}

async function matchRating(item: RatingItem, resolver: Resolver): Promise<Match> {
  if (item.subject === "movie") return resolver.movie(item.ids, item);
  if (item.subject === "show") return resolver.show(item.ids, item);
  if (item.subject === "season") return resolver.season(item.ids, item.seasonNumber ?? 0, item.seasonTmdbId, item);
  return resolver.episode(item.ids, item.seasonNumber ?? 0, item.episodeNumber ?? 0, item.episodeIds, item);
}

async function applyWatchlist(
  userId: string,
  parsed: ParsedExport,
  resolver: Resolver,
  unmatched: ImportErrorReport["unmatched"],
  counts: ImportErrorReport["counts"],
) {
  const db = getDb();
  const current = await db
    .select({ movieId: watchlistItems.movieId, showId: watchlistItems.showId })
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId));
  const movies = new Set(current.map((row) => row.movieId).filter((id): id is string => Boolean(id)));
  const shows = new Set(current.map((row) => row.showId).filter((id): id is string => Boolean(id)));
  let position = await nextPosition(userId, null);
  for (const item of parsed.watchlist) {
    const saved = await saveTitleItem(item, resolver, unmatched, movies, shows, async (kind, id) => {
      await db.insert(watchlistItems).values({
        userId,
        movieId: kind === "movie" ? id : null,
        showId: kind === "show" ? id : null,
        position,
        addedAt: atOrNow(item.at),
      });
      position += 1;
    });
    if (saved) counts.watchlist += 1;
  }
}

async function applyLists(
  userId: string,
  parsed: ParsedExport,
  resolver: Resolver,
  unmatched: ImportErrorReport["unmatched"],
  counts: ImportErrorReport["counts"],
) {
  const db = getDb();
  const owned = await db.select({ id: lists.id, name: lists.name }).from(lists).where(eq(lists.ownerId, userId));
  const byName = new Map(owned.map((list) => [list.name, list.id]));
  for (const list of parsed.lists) {
    const matched: { kind: "movie" | "show"; id: string; at: string | null; note: string | null }[] = [];
    for (const item of list.items) {
      const match = item.kind === "movie" ? await resolver.movie(item.ids, item) : await resolver.show(item.ids, item);
      if (!match.ok) {
        unmatched.push({ title: item.title || "Untitled", year: item.year, reason: match.reason });
        continue;
      }
      matched.push({ kind: item.kind, id: match.id, at: item.at, note: item.note });
    }
    if (list.items.length > 0 && matched.length === 0) continue;
    let listId = byName.get(list.name);
    if (!listId) {
      const [created] = await db
        .insert(lists)
        .values({
          ownerId: userId,
          name: list.name,
          description: list.description,
          visibility: "private",
          createdAt: new Date(),
        })
        .returning({ id: lists.id });
      if (!created) continue;
      listId = created.id;
      byName.set(list.name, listId);
      counts.lists += 1;
    }
    const current = await db
      .select({ movieId: listItems.movieId, showId: listItems.showId })
      .from(listItems)
      .where(eq(listItems.listId, listId));
    const movies = new Set(current.map((row) => row.movieId).filter((id): id is string => Boolean(id)));
    const shows = new Set(current.map((row) => row.showId).filter((id): id is string => Boolean(id)));
    let position = await nextPosition(null, listId);
    for (const item of matched) {
      const have = item.kind === "movie" ? movies : shows;
      if (have.has(item.id)) continue;
      try {
        await db.insert(listItems).values({
          listId,
          movieId: item.kind === "movie" ? item.id : null,
          showId: item.kind === "show" ? item.id : null,
          position,
          note: item.note,
          addedAt: atOrNow(item.at),
        });
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
      have.add(item.id);
      position += 1;
      counts.list_items += 1;
    }
  }
}

async function applyShelf(
  userId: string,
  parsed: ParsedExport,
  resolver: Resolver,
  unmatched: ImportErrorReport["unmatched"],
  counts: ImportErrorReport["counts"],
) {
  const db = getDb();
  const current = await db
    .select({ movieId: shelfItems.movieId, episodeId: shelfItems.episodeId })
    .from(shelfItems)
    .where(eq(shelfItems.userId, userId));
  const movies = new Set(current.map((row) => row.movieId).filter((id): id is string => Boolean(id)));
  const episodesOwned = new Set(current.map((row) => row.episodeId).filter((id): id is string => Boolean(id)));
  for (const item of parsed.shelf) {
    const match =
      item.kind === "movie"
        ? await resolver.movie(item.ids, item)
        : await resolver.episode(item.ids, item.seasonNumber ?? 0, item.episodeNumber ?? 0, item.episodeIds, item);
    if (!match.ok) {
      unmatched.push({ title: item.title || "Untitled", year: item.year, reason: match.reason });
      continue;
    }
    const have = item.kind === "movie" ? movies : episodesOwned;
    if (have.has(match.id)) continue;
    try {
      await db.insert(shelfItems).values({
        userId,
        movieId: item.kind === "movie" ? match.id : null,
        episodeId: item.kind === "episode" ? match.id : null,
        addedAt: atOrNow(item.at),
      });
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
    have.add(match.id);
    counts.shelf += 1;
  }
}

async function saveTitleItem(
  item: TitleItem,
  resolver: Resolver,
  unmatched: ImportErrorReport["unmatched"],
  movies: Set<string>,
  shows: Set<string>,
  insert: (kind: "movie" | "show", id: string) => Promise<void>,
): Promise<boolean> {
  const match = item.kind === "movie" ? await resolver.movie(item.ids, item) : await resolver.show(item.ids, item);
  if (!match.ok) {
    unmatched.push({ title: item.title || "Untitled", year: item.year, reason: match.reason });
    return false;
  }
  const have = item.kind === "movie" ? movies : shows;
  if (have.has(match.id)) return false;
  try {
    await insert(item.kind, match.id);
  } catch (error) {
    if (isUniqueViolation(error)) return false;
    throw error;
  }
  have.add(match.id);
  return true;
}

async function nextPosition(userId: string | null, listId: string | null): Promise<number> {
  const db = getDb();
  if (userId) {
    const [row] = await db
      .select({ max: sql<number>`coalesce(max(${watchlistItems.position}), -1)` })
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, userId));
    return Number(row?.max ?? -1) + 1;
  }
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${listItems.position}), -1)` })
    .from(listItems)
    .where(eq(listItems.listId, listId ?? ""));
  return Number(row?.max ?? -1) + 1;
}

function atOrNow(value: string | null): Date {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && (error as { code?: string }).code === "23505") return true;
  if ("cause" in error) return isUniqueViolation((error as { cause: unknown }).cause);
  return false;
}
