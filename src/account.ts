import { asc, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "./db";
import {
  accounts,
  episodes,
  listItems,
  lists,
  plays,
  ratings,
  resumePoints,
  sessions,
  importJobs,
  shelfItems,
  titles,
  users,
  verifications,
  watchlistItems,
} from "./db/schema";
import { deleteImportFiles } from "./import/store";

type Media = { id: string; name: string; year: number | null; tmdb_id: number };

export type TryktExport = {
  format: "trykt.export.v0";
  exported_at: string;
  plays: Array<{
    id: string;
    watched_at: string;
    source: string;
    rewatch: boolean;
    movie: Media | null;
    episode: {
      id: string;
      name: string;
      season_number: number;
      episode_number: number;
      show: Media;
    } | null;
  }>;
  ratings: Array<{
    id: string;
    score: number;
    updated_at: string;
    subject_type: string;
    subject_id: string;
  }>;
  watchlist: Array<{
    id: string;
    position: number;
    added_at: string;
    movie: Media | null;
    show: Media | null;
  }>;
  lists: Array<{
    id: string;
    name: string;
    description: string | null;
    visibility: string;
    items: Array<{
      id: string;
      position: number;
      note: string | null;
      added_at: string;
      movie: Media | null;
      show: Media | null;
    }>;
  }>;
  shelf: Array<{
    id: string;
    added_at: string;
    movie: Media | null;
    episode: {
      id: string;
      name: string;
      season_number: number;
      episode_number: number;
      show: Media;
    } | null;
  }>;
};

function media(row: { id: string; name: string; year: number | null; tmdbId: number } | undefined): Media | null {
  if (!row) return null;
  return { id: row.id, name: row.name, year: row.year, tmdb_id: row.tmdbId };
}

export async function exportUser(userId: string): Promise<TryktExport> {
  const db = getDb();
  const playRows = await db.select().from(plays).where(eq(plays.userId, userId)).orderBy(desc(plays.watchedAt));
  const ratingRows = await db.select().from(ratings).where(eq(ratings.userId, userId)).orderBy(desc(ratings.updatedAt));
  const watchRows = await db
    .select()
    .from(watchlistItems)
    .where(eq(watchlistItems.userId, userId))
    .orderBy(asc(watchlistItems.position));
  const listRows = await db.select().from(lists).where(eq(lists.ownerId, userId)).orderBy(desc(lists.createdAt));
  const listIds = listRows.map((list) => list.id);
  const itemRows = listIds.length
    ? await db.select().from(listItems).where(inArray(listItems.listId, listIds)).orderBy(asc(listItems.position))
    : [];
  const shelfRows = await db.select().from(shelfItems).where(eq(shelfItems.userId, userId)).orderBy(desc(shelfItems.addedAt));

  const episodeIds = [
    ...playRows.map((row) => row.episodeId),
    ...shelfRows.map((row) => row.episodeId),
  ].filter((id): id is string => Boolean(id));
  const episodeRows = episodeIds.length
    ? await db.select().from(episodes).where(inArray(episodes.id, episodeIds))
    : [];
  const episodeById = new Map(episodeRows.map((row) => [row.id, row]));

  const titleIds = new Set<string>();
  for (const row of playRows) if (row.movieId) titleIds.add(row.movieId);
  for (const row of episodeRows) titleIds.add(row.showId);
  for (const row of watchRows) {
    if (row.movieId) titleIds.add(row.movieId);
    if (row.showId) titleIds.add(row.showId);
  }
  for (const row of itemRows) {
    if (row.movieId) titleIds.add(row.movieId);
    if (row.showId) titleIds.add(row.showId);
  }
  for (const row of shelfRows) {
    if (row.movieId) titleIds.add(row.movieId);
  }
  const titleRows = titleIds.size
    ? await db
        .select({
          id: titles.id,
          name: titles.name,
          year: titles.year,
          tmdbId: titles.tmdbId,
        })
        .from(titles)
        .where(inArray(titles.id, [...titleIds]))
    : [];
  const titleById = new Map(titleRows.map((row) => [row.id, row]));

  return {
    format: "trykt.export.v0",
    exported_at: new Date().toISOString(),
    plays: playRows.map((row) => {
      const episode = row.episodeId ? episodeById.get(row.episodeId) : undefined;
      const show = episode ? titleById.get(episode.showId) : undefined;
      return {
        id: row.id,
        watched_at: row.watchedAt.toISOString(),
        source: row.source,
        rewatch: row.rewatch,
        movie: row.movieId ? media(titleById.get(row.movieId)) : null,
        episode:
          episode && show
            ? {
                id: episode.id,
                name: episode.name,
                season_number: episode.seasonNumber,
                episode_number: episode.episodeNumber,
                show: media(show)!,
              }
            : null,
      };
    }),
    ratings: ratingRows.map((row) => ({
      id: row.id,
      score: row.score,
      updated_at: row.updatedAt.toISOString(),
      subject_type: row.subjectType,
      subject_id: row.subjectId,
    })),
    watchlist: watchRows.map((row) => ({
      id: row.id,
      position: row.position,
      added_at: row.addedAt.toISOString(),
      movie: row.movieId ? media(titleById.get(row.movieId)) : null,
      show: row.showId ? media(titleById.get(row.showId)) : null,
    })),
    lists: listRows.map((list) => ({
      id: list.id,
      name: list.name,
      description: list.description,
      visibility: list.visibility,
      items: itemRows
        .filter((item) => item.listId === list.id)
        .map((item) => ({
          id: item.id,
          position: item.position,
          note: item.note,
          added_at: item.addedAt.toISOString(),
          movie: item.movieId ? media(titleById.get(item.movieId)) : null,
          show: item.showId ? media(titleById.get(item.showId)) : null,
        })),
    })),
    shelf: shelfRows.map((row) => {
      const episode = row.episodeId ? episodeById.get(row.episodeId) : undefined;
      const show = episode ? titleById.get(episode.showId) : undefined;
      return {
        id: row.id,
        added_at: row.addedAt.toISOString(),
        movie: row.movieId ? media(titleById.get(row.movieId)) : null,
        episode:
          episode && show
            ? {
                id: episode.id,
                name: episode.name,
                season_number: episode.seasonNumber,
                episode_number: episode.episodeNumber,
                show: media(show)!,
              }
            : null,
      };
    }),
  };
}

export async function deleteUserAccount(userId: string) {
  const db = getDb();
  const [person] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (!person) return;
  let jobIds: string[] = [];
  await db.transaction(async (tx) => {
    const jobs = await tx.select({ id: importJobs.id }).from(importJobs).where(eq(importJobs.userId, userId));
    jobIds = jobs.map((job) => job.id);
    if (jobIds.length > 0) await tx.delete(importJobs).where(eq(importJobs.userId, userId));
    const owned = await tx.select({ id: lists.id }).from(lists).where(eq(lists.ownerId, userId));
    const listIds = owned.map((list) => list.id);
    if (listIds.length > 0) {
      await tx.delete(listItems).where(inArray(listItems.listId, listIds));
    }
    await tx.delete(lists).where(eq(lists.ownerId, userId));
    await tx.delete(plays).where(eq(plays.userId, userId));
    await tx.delete(resumePoints).where(eq(resumePoints.userId, userId));
    await tx.delete(watchlistItems).where(eq(watchlistItems.userId, userId));
    await tx.delete(ratings).where(eq(ratings.userId, userId));
    await tx.delete(shelfItems).where(eq(shelfItems.userId, userId));
    await tx.delete(sessions).where(eq(sessions.userId, userId));
    await tx.delete(accounts).where(eq(accounts.userId, userId));
    await tx
      .delete(verifications)
      .where(or(eq(verifications.value, userId), eq(verifications.identifier, person.email)));
    await tx.delete(users).where(eq(users.id, userId));
  });
  await deleteImportFiles(jobIds);
}
