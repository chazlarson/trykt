import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "./db";
import { episodes, listItems, lists, ratings, seasons, shelfItems, titles, watchlistItems } from "./db/schema";
import type { RatingSubject } from "./db/schema";
import { AppError } from "./errors";

export type MediaRef = {
  id: string;
  name: string;
  year: number | null;
  tmdbId: number;
};

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ("code" in error && (error as { code?: string }).code === "23505") return true;
  if ("cause" in error) return isUniqueViolation((error as { cause: unknown }).cause);
  return false;
}

async function requireTitle(id: string, kind: "movie" | "show"): Promise<MediaRef> {
  const db = getDb();
  const [row] = await db
    .select({
      id: titles.id,
      name: titles.name,
      year: titles.year,
      tmdbId: titles.tmdbId,
    })
    .from(titles)
    .where(and(eq(titles.id, id), eq(titles.kind, kind)));
  if (!row) throw new AppError("missing");
  return row;
}

async function nextPosition(table: "watchlist" | "list", ownerKey: string) {
  const db = getDb();
  if (table === "watchlist") {
    const [row] = await db
      .select({ max: sql<number>`coalesce(max(${watchlistItems.position}), -1)` })
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, ownerKey));
    return Number(row?.max ?? -1) + 1;
  }
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${listItems.position}), -1)` })
    .from(listItems)
    .where(eq(listItems.listId, ownerKey));
  return Number(row?.max ?? -1) + 1;
}

export async function addToWatchlist(userId: string, kind: "movie" | "show", titleId: string) {
  await requireTitle(titleId, kind);
  const db = getDb();
  const position = await nextPosition("watchlist", userId);
  try {
    await db.insert(watchlistItems).values({
      userId,
      movieId: kind === "movie" ? titleId : null,
      showId: kind === "show" ? titleId : null,
      position,
      addedAt: new Date(),
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

export async function removeWatchlistItem(userId: string, itemId: string) {
  const db = getDb();
  await db.delete(watchlistItems).where(and(eq(watchlistItems.id, itemId), eq(watchlistItems.userId, userId)));
}

export async function watchlistItemForTitle(userId: string, kind: "movie" | "show", titleId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: watchlistItems.id })
    .from(watchlistItems)
    .where(
      and(
        eq(watchlistItems.userId, userId),
        kind === "movie" ? eq(watchlistItems.movieId, titleId) : eq(watchlistItems.showId, titleId),
      ),
    );
  return row ?? null;
}

export async function listWatchlist(userId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: watchlistItems.id,
      position: watchlistItems.position,
      addedAt: watchlistItems.addedAt,
      movieId: watchlistItems.movieId,
      showId: watchlistItems.showId,
    })
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId))
    .orderBy(asc(watchlistItems.position), asc(watchlistItems.addedAt));
  const ids = rows.flatMap((row) => [row.movieId, row.showId].filter((id): id is string => Boolean(id)));
  const titleRows = ids.length
    ? await db
        .select({
          id: titles.id,
          name: titles.name,
          year: titles.year,
          tmdbId: titles.tmdbId,
          kind: titles.kind,
        })
        .from(titles)
        .where(inArray(titles.id, ids))
    : [];
  const byId = new Map(titleRows.map((row) => [row.id, row]));
  return rows.map((row) => ({
    id: row.id,
    position: row.position,
    addedAt: row.addedAt,
    movie: row.movieId ? toMedia(byId.get(row.movieId)) : null,
    show: row.showId ? toMedia(byId.get(row.showId)) : null,
  }));
}

function toMedia(
  row: { id: string; name: string; year: number | null; tmdbId: number } | undefined,
): MediaRef | null {
  if (!row) return null;
  return { id: row.id, name: row.name, year: row.year, tmdbId: row.tmdbId };
}

export async function createList(userId: string, name: string, description: string | null) {
  const db = getDb();
  const [row] = await db
    .insert(lists)
    .values({
      ownerId: userId,
      name,
      description,
      visibility: "private",
      createdAt: new Date(),
    })
    .returning({ id: lists.id });
  if (!row) throw new AppError("fields");
  return row;
}

export async function listLists(userId: string) {
  const db = getDb();
  return db
    .select({
      id: lists.id,
      name: lists.name,
      description: lists.description,
      visibility: lists.visibility,
    })
    .from(lists)
    .where(eq(lists.ownerId, userId))
    .orderBy(desc(lists.createdAt));
}

export async function getListForOwner(userId: string, listId: string) {
  const db = getDb();
  const [list] = await db.select().from(lists).where(and(eq(lists.id, listId), eq(lists.ownerId, userId)));
  if (!list) return null;
  const items = await db
    .select()
    .from(listItems)
    .where(eq(listItems.listId, listId))
    .orderBy(asc(listItems.position), asc(listItems.addedAt));
  const ids = items.flatMap((item) => [item.movieId, item.showId].filter((id): id is string => Boolean(id)));
  const titleRows = ids.length
    ? await db
        .select({
          id: titles.id,
          name: titles.name,
          year: titles.year,
          tmdbId: titles.tmdbId,
        })
        .from(titles)
        .where(inArray(titles.id, ids))
    : [];
  const byId = new Map(titleRows.map((row) => [row.id, row]));
  return {
    ...list,
    items: items.map((item) => ({
      id: item.id,
      position: item.position,
      note: item.note,
      addedAt: item.addedAt,
      movie: item.movieId ? toMedia(byId.get(item.movieId)) : null,
      show: item.showId ? toMedia(byId.get(item.showId)) : null,
    })),
  };
}

export async function addListItem(userId: string, listId: string, kind: "movie" | "show", titleId: string) {
  const list = await getListForOwner(userId, listId);
  if (!list) throw new AppError("list-missing");
  await requireTitle(titleId, kind);
  const db = getDb();
  const position = await nextPosition("list", listId);
  try {
    await db.insert(listItems).values({
      listId,
      movieId: kind === "movie" ? titleId : null,
      showId: kind === "show" ? titleId : null,
      position,
      note: null,
      addedAt: new Date(),
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError("listed");
    throw error;
  }
}

export async function removeListItem(userId: string, listId: string, itemId: string) {
  const list = await getListForOwner(userId, listId);
  if (!list) throw new AppError("list-missing");
  const db = getDb();
  await db.delete(listItems).where(and(eq(listItems.id, itemId), eq(listItems.listId, listId)));
}

async function subjectExists(subjectType: RatingSubject, subjectId: string) {
  const db = getDb();
  if (subjectType === "movie" || subjectType === "show") {
    const [row] = await db
      .select({ id: titles.id })
      .from(titles)
      .where(and(eq(titles.id, subjectId), eq(titles.kind, subjectType)));
    return Boolean(row);
  }
  if (subjectType === "season") {
    const [row] = await db.select({ id: seasons.id }).from(seasons).where(eq(seasons.id, subjectId));
    return Boolean(row);
  }
  const [row] = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.id, subjectId));
  return Boolean(row);
}

export async function setRating(userId: string, subjectType: RatingSubject, subjectId: string, score: number) {
  if (!(await subjectExists(subjectType, subjectId))) throw new AppError("missing");
  const db = getDb();
  await db
    .insert(ratings)
    .values({
      userId,
      subjectType,
      subjectId,
      score,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [ratings.userId, ratings.subjectType, ratings.subjectId],
      set: { score, updatedAt: new Date() },
    });
}

export async function clearRating(userId: string, subjectType: RatingSubject, subjectId: string) {
  const db = getDb();
  await db
    .delete(ratings)
    .where(and(eq(ratings.userId, userId), eq(ratings.subjectType, subjectType), eq(ratings.subjectId, subjectId)));
}

export async function getRating(userId: string, subjectType: RatingSubject, subjectId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: ratings.id, score: ratings.score })
    .from(ratings)
    .where(and(eq(ratings.userId, userId), eq(ratings.subjectType, subjectType), eq(ratings.subjectId, subjectId)));
  return row ?? null;
}

export async function addMovieToShelf(userId: string, movieId: string) {
  await requireTitle(movieId, "movie");
  const db = getDb();
  try {
    await db.insert(shelfItems).values({
      userId,
      movieId,
      addedAt: new Date(),
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
  }
}

export async function removeShelfItem(userId: string, itemId: string) {
  const db = getDb();
  await db.delete(shelfItems).where(and(eq(shelfItems.id, itemId), eq(shelfItems.userId, userId)));
}

export async function shelfItemForMovie(userId: string, movieId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: shelfItems.id })
    .from(shelfItems)
    .where(and(eq(shelfItems.userId, userId), eq(shelfItems.movieId, movieId)));
  return row ?? null;
}

export async function listShelf(userId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: shelfItems.id,
      addedAt: shelfItems.addedAt,
      movieId: shelfItems.movieId,
      episodeId: shelfItems.episodeId,
    })
    .from(shelfItems)
    .where(eq(shelfItems.userId, userId))
    .orderBy(desc(shelfItems.addedAt));
  const movieIds = rows.map((row) => row.movieId).filter((id): id is string => Boolean(id));
  const episodeIds = rows.map((row) => row.episodeId).filter((id): id is string => Boolean(id));
  const episodeRows = episodeIds.length ? await db.select().from(episodes).where(inArray(episodes.id, episodeIds)) : [];
  const showIds = episodeRows.map((row) => row.showId);
  const titleRows = [...movieIds, ...showIds].length
    ? await db
        .select({
          id: titles.id,
          name: titles.name,
          year: titles.year,
          tmdbId: titles.tmdbId,
        })
        .from(titles)
        .where(inArray(titles.id, [...movieIds, ...showIds]))
    : [];
  const byId = new Map(titleRows.map((row) => [row.id, row]));
  const episodeById = new Map(episodeRows.map((row) => [row.id, row]));
  return rows.map((row) => {
    const episode = row.episodeId ? episodeById.get(row.episodeId) : undefined;
    const show = episode ? byId.get(episode.showId) : undefined;
    return {
      id: row.id,
      addedAt: row.addedAt,
      movie: row.movieId ? toMedia(byId.get(row.movieId)) : null,
      episode:
        episode && show
          ? {
              id: episode.id,
              name: episode.name,
              seasonNumber: episode.seasonNumber,
              episodeNumber: episode.episodeNumber,
              showId: show.id,
              showName: show.name,
            }
          : null,
    };
  });
}
