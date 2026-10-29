import { describe, expect, it } from "vitest";
import { getDb } from "../db";
import { episodes, seasons, titles, users } from "../db/schema";
import { logEpisode } from "../plays";
import { showsDueForDailyRefresh } from "./refresh";

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

async function showWithEpisode(status: string, tmdbId: number) {
  const db = getDb();
  const [show] = await db
    .insert(titles)
    .values({ kind: "show", tmdbId, name: status, status, fetchedAt: new Date() })
    .returning();
  if (!show) throw new Error("show");
  const [season] = await db
    .insert(seasons)
    .values({ showId: show.id, seasonNumber: 1, tmdbId: tmdbId + 1000, name: "Season 1", fetchedAt: new Date() })
    .returning();
  if (!season) throw new Error("season");
  const [episode] = await db
    .insert(episodes)
    .values({
      showId: show.id,
      seasonId: season.id,
      seasonNumber: 1,
      episodeNumber: 1,
      tmdbId: tmdbId + 2000,
      name: "One",
      airDate: "2020-01-01",
      fetchedAt: new Date(),
    })
    .returning();
  if (!episode) throw new Error("episode");
  return { show, episode };
}

describe("daily refresh", () => {
  it("includes a returning show after the cached episodes are all played", async () => {
    const userId = await user("ada");
    const caughtUp = await showWithEpisode("Returning Series", 11);
    const stillAiring = await showWithEpisode("In Production", 12);
    const ended = await showWithEpisode("Ended", 13);
    const unwatched = await showWithEpisode("Returning Series", 14);
    await logEpisode(userId, caughtUp.episode.id, new Date("2020-01-02T00:00:00.000Z"));
    await logEpisode(userId, stillAiring.episode.id, new Date("2020-01-02T00:00:00.000Z"));
    await logEpisode(userId, ended.episode.id, new Date("2020-01-02T00:00:00.000Z"));

    const due = await showsDueForDailyRefresh();
    expect(due).toContain(caughtUp.show.id);
    expect(due).toContain(stillAiring.show.id);
    expect(due).not.toContain(ended.show.id);
    expect(due).not.toContain(unwatched.show.id);
  });
});
