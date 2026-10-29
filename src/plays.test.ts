import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "./db";
import { episodes, plays, seasons, titles, users } from "./db/schema";
import { clearManualEpisodePlays, logEpisode, logSeason, nextEpisode, removePlay } from "./plays";

async function days() {
  const rows = await getDb().execute<{ today: string; yesterday: string; tomorrow: string }>(sql`
    select current_date::text as today,
           (current_date - 1)::text as yesterday,
           (current_date + 1)::text as tomorrow
  `);
  const row = rows[0];
  if (!row) throw new Error("database did not return dates");
  return row;
}

async function user(username: string) {
  const id = crypto.randomUUID();
  await getDb().insert(users).values({
    id,
    name: username,
    email: `${username}@example.com`,
    emailVerified: true,
    username,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

async function showWithEpisodes() {
  const db = getDb();
  const date = await days();
  const [show] = await db
    .insert(titles)
    .values({ kind: "show", tmdbId: 4242, name: "Example Show", status: "Returning Series", fetchedAt: new Date() })
    .returning();
  if (!show) throw new Error("show");
  const [specials] = await db
    .insert(seasons)
    .values({ showId: show.id, seasonNumber: 0, tmdbId: 1, name: "Specials", fetchedAt: new Date() })
    .returning();
  const [season] = await db
    .insert(seasons)
    .values({ showId: show.id, seasonNumber: 1, tmdbId: 2, name: "Season 1", fetchedAt: new Date() })
    .returning();
  if (!specials || !season) throw new Error("season");
  await db.insert(episodes).values([
    {
      showId: show.id,
      seasonId: specials.id,
      seasonNumber: 0,
      episodeNumber: 1,
      tmdbId: 10,
      name: "Special",
      airDate: date.today,
      fetchedAt: new Date(),
    },
    {
      showId: show.id,
      seasonId: season.id,
      seasonNumber: 1,
      episodeNumber: 1,
      tmdbId: 11,
      name: "One",
      airDate: date.yesterday,
      fetchedAt: new Date(),
    },
    {
      showId: show.id,
      seasonId: season.id,
      seasonNumber: 1,
      episodeNumber: 2,
      tmdbId: 12,
      name: "Two",
      airDate: date.yesterday,
      fetchedAt: new Date(),
    },
    {
      showId: show.id,
      seasonId: season.id,
      seasonNumber: 1,
      episodeNumber: 3,
      tmdbId: 13,
      name: "Finale",
      airDate: date.tomorrow,
      fetchedAt: new Date(),
    },
  ]);
  const episodeRows = await db.select().from(episodes).where(eq(episodes.showId, show.id));
  const byNumber = (seasonNumber: number, episodeNumber: number) => {
    const found = episodeRows.find((row) => row.seasonNumber === seasonNumber && row.episodeNumber === episodeNumber);
    if (!found) throw new Error(`missing S${seasonNumber}E${episodeNumber}`);
    return found;
  };
  return { show, specials, season, byNumber };
}

describe("next episode", () => {
  let userId = "";

  beforeEach(async () => {
    userId = await user("ada");
  });

  it("skips specials and an unaired finale", async () => {
    const { show, byNumber } = await showWithEpisodes();
    const first = await nextEpisode(userId, show.id);
    expect(first?.episodeNumber).toBe(1);
    expect(first?.seasonNumber).toBe(1);

    await logEpisode(userId, byNumber(1, 1).id, new Date("2020-01-01T00:00:00.000Z"));
    const second = await nextEpisode(userId, show.id);
    expect(second?.episodeNumber).toBe(2);
    expect(second?.seasonNumber).toBe(1);

    await logEpisode(userId, byNumber(1, 2).id, new Date("2020-01-02T00:00:00.000Z"));
    expect(await nextEpisode(userId, show.id)).toBeNull();
  });
});

describe("bulk season", () => {
  it("skips episodes that already have a play and skips season 0", async () => {
    const userId = await user("bea");
    const { specials, season, byNumber } = await showWithEpisodes();
    const watchedAt = new Date("2024-05-01T12:00:00.000Z");
    await logEpisode(userId, byNumber(1, 2).id, watchedAt);

    const inserted = await logSeason(userId, season.id, watchedAt);
    expect(inserted.inserted).toBe(2);

    const rows = await getDb().select().from(plays).where(eq(plays.userId, userId));
    const episodeTwo = rows.filter((row) => row.episodeId === byNumber(1, 2).id);
    expect(episodeTwo).toHaveLength(1);
    expect(episodeTwo[0]?.source).toBe("manual");
    const bulk = rows.filter((row) => row.source === "bulk");
    expect(bulk).toHaveLength(2);
    expect(bulk.map((row) => row.episodeId).sort()).toEqual([byNumber(1, 1).id, byNumber(1, 3).id].sort());

    expect((await logSeason(userId, specials.id, watchedAt)).inserted).toBe(0);
    const after = await getDb().select().from(plays).where(eq(plays.userId, userId));
    expect(after).toHaveLength(3);
  });

  it("leaves playback plays in place when manual logs are cleared", async () => {
    const userId = await user("cy");
    const { byNumber } = await showWithEpisodes();
    const episodeId = byNumber(1, 1).id;
    await getDb().insert(plays).values({
      userId,
      episodeId,
      watchedAt: new Date("2024-01-01T00:00:00.000Z"),
      source: "playback",
      rewatch: false,
    });
    expect(await clearManualEpisodePlays(userId, episodeId)).toBe(0);
    const [kept] = await getDb().select().from(plays).where(eq(plays.userId, userId));
    expect(kept?.source).toBe("playback");
    expect(await removePlay(userId, kept!.id)).toBe(true);
    const left = await getDb().select().from(plays).where(eq(plays.userId, userId));
    expect(left).toHaveLength(0);
    expect(await removePlay("someone-else", kept!.id)).toBe(false);
  });
});
