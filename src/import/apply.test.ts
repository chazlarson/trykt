import { eq } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { existsSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteUserAccount } from "../account";
import { fetchMovie, fetchSeason, fetchShow, findByImdb } from "../catalog/tmdb";
import { getDb } from "../db";
import { episodes, importJobs, lists, plays, ratings, seasons, shelfItems, titles, users, watchlistItems } from "../db/schema";
import { applyImport } from "./apply";
import { runImportJob } from "./job";
import { parseExportZip } from "./parser";
import { createCatalogResolver } from "./resolve";
import { acceptImport, importForOwner, importZipPath } from "./store";

vi.mock("../catalog/tmdb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../catalog/tmdb")>();
  return {
    ...actual,
    fetchMovie: vi.fn(),
    fetchShow: vi.fn(),
    fetchSeason: vi.fn(),
    findByImdb: vi.fn(),
  };
});

function zipOf(files: Record<string, unknown>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) entries[name] = strToU8(JSON.stringify(value));
  return zipSync(entries);
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

beforeEach(() => {
  vi.mocked(fetchMovie).mockRejectedValue(new Error("movie fetch"));
  vi.mocked(fetchShow).mockRejectedValue(new Error("show fetch"));
  vi.mocked(fetchSeason).mockRejectedValue(new Error("season fetch"));
  vi.mocked(findByImdb).mockRejectedValue(new Error("find"));
});

describe("applyImport", () => {
  it("logs plays, ratings, a private list, the watchlist, and the shelf", async () => {
    vi.mocked(fetchSeason).mockResolvedValue({
      tmdbId: 50,
      seasonNumber: 1,
      name: "Season 1",
      episodes: [
        { tmdbId: 501, episodeNumber: 1, name: "One", overview: null, airDate: "2019-01-01", runtimeMin: 40, stillPath: null },
        { tmdbId: 502, episodeNumber: 2, name: "Two", overview: null, airDate: "2019-01-08", runtimeMin: 40, stillPath: null },
      ],
    });
    const userId = await user("importer");
    const parsed = parseExportZip(
      zipOf({
        "watched-history-1.json": [
          { watched_at: "2014-01-01T00:00:00.000Z", type: "movie", movie: { title: "Paper Moon", year: 1973, ids: { tmdb: 18131, imdb: "tt0070510" } } },
          { watched_at: "2014-01-02T00:00:00.000Z", type: "movie", movie: { title: "Paper Moon", year: 1973, ids: { tmdb: 18131 } } },
          { watched_at: "2014-02-01T00:00:00.000Z", type: "episode", episode: { season: 1, number: 1 }, show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } } },
          { watched_at: "2014-02-02T00:00:00.000Z", type: "episode", episode: { season: 1, number: 2 }, show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } } },
        ],
        "ratings-movies.json": [{ rated_at: "2014-03-01T00:00:00.000Z", rating: 8, movie: { title: "Paper Moon", year: 1973, ids: { tmdb: 18131 } } }],
        "ratings-seasons.json": [
          { rating: 9, season: { number: 1, ids: { tmdb: 3572 } }, show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } } },
        ],
        "lists-watchlist.json": [{ type: "show", show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } } }],
        "lists-lists.json": [{ name: "Sunday shelf", description: "Quiet titles", ids: { ref: 15, slug: "sunday" } }],
        "lists-list-15-sunday.json": [{ type: "movie", movie: { title: "Paper Moon", year: 1973, ids: { tmdb: 18131 } } }],
        "collection-movies.json": [{ movie: { title: "Paper Moon", year: 1973, ids: { tmdb: 18131 } } }],
        "collection-shows.json": [
          { show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } }, seasons: [{ number: 1, episodes: [{ number: 2 }] }] },
        ],
        "comments-movies.json": [{ comment: { comment: "secret note about a hospital" } }],
      }),
    );
    const report = await applyImport(userId, parsed, createCatalogResolver());
    expect(fetchMovie).not.toHaveBeenCalled();
    expect(fetchSeason).toHaveBeenCalledTimes(1);
    expect(report.counts).toMatchObject({ plays: 4, ratings: 2, watchlist: 1, lists: 1, list_items: 1, shelf: 2, notes_skipped: 1 });
    expect(JSON.stringify(report)).not.toContain("secret note about a hospital");
    const db = getDb();
    const playRows = await db.select().from(plays).where(eq(plays.userId, userId)).orderBy(plays.watchedAt);
    expect(playRows.map((row) => row.source)).toEqual(["import", "import", "import", "import"]);
    expect(playRows.map((row) => row.rewatch)).toEqual([false, true, false, false]);
    const [movie] = await db.select().from(titles).where(eq(titles.tmdbId, 18131));
    expect(movie).toMatchObject({ kind: "movie", name: "Paper Moon", imdbId: "tt0070510" });
    const [list] = await db.select().from(lists).where(eq(lists.ownerId, userId));
    expect(list).toMatchObject({ name: "Sunday shelf", visibility: "private" });
    const watch = await db.select().from(watchlistItems).where(eq(watchlistItems.userId, userId));
    expect(watch).toHaveLength(1);
    const shelf = await db.select().from(shelfItems).where(eq(shelfItems.userId, userId));
    expect(shelf).toHaveLength(2);
    const score = await db.select().from(ratings).where(eq(ratings.userId, userId));
    expect(score.map((row) => row.score).sort()).toEqual([8, 9]);
    const again = await applyImport(userId, parsed, createCatalogResolver());
    expect(again.counts.plays).toBe(0);
    const after = await db.select().from(plays).where(eq(plays.userId, userId));
    expect(after).toHaveLength(4);
  });

  it("matches an IMDb id through find, and uses a cached episode without a fetch", async () => {
    vi.mocked(findByImdb).mockResolvedValue({ movieTmdbId: 550, showTmdbId: null, episode: null, season: null });
    const userId = await user("finder");
    const db = getDb();
    const [show] = await db
      .insert(titles)
      .values({ kind: "show", tmdbId: 1396, name: "Example Show", year: 2008 })
      .returning();
    if (!show) throw new Error("show");
    const [season] = await db
      .insert(seasons)
      .values({ showId: show.id, seasonNumber: 1, tmdbId: 2, name: "Season 1" })
      .returning();
    if (!season) throw new Error("season");
    await db.insert(episodes).values({
      showId: show.id,
      seasonId: season.id,
      seasonNumber: 1,
      episodeNumber: 1,
      tmdbId: 11,
      name: "One",
    });
    const parsed = parseExportZip(
      zipOf({
        "watched-history-1.json": [
          { watched_at: "2011-01-01T00:00:00.000Z", type: "movie", movie: { title: "Known", year: 1999, ids: { imdb: "tt0137523" } } },
          { watched_at: "2011-02-01T00:00:00.000Z", type: "episode", episode: { season: 1, number: 1 }, show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } } },
        ],
      }),
    );
    const report = await applyImport(userId, parsed, createCatalogResolver());
    expect(report.counts.plays).toBe(2);
    expect(report.unmatched).toEqual([]);
    expect(findByImdb).toHaveBeenCalledWith("tt0137523");
    expect(fetchSeason).not.toHaveBeenCalled();
    const [movie] = await db.select().from(titles).where(eq(titles.tmdbId, 550));
    expect(movie?.name).toBe("Known");
  });

  it("keeps a newer local rating and records a TMDB miss", async () => {
    vi.mocked(fetchSeason).mockResolvedValue(null);
    const userId = await user("rater");
    const db = getDb();
    const [movie] = await db
      .insert(titles)
      .values({ kind: "movie", tmdbId: 18131, name: "Paper Moon", year: 1973 })
      .returning();
    if (!movie) throw new Error("movie");
    await db.insert(ratings).values({
      userId,
      subjectType: "movie",
      subjectId: movie.id,
      score: 9,
      updatedAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const parsed = parseExportZip(
      zipOf({
        "watched-history-1.json": [],
        "ratings-movies.json": [{ rated_at: "2010-01-01T00:00:00.000Z", rating: 2, movie: { title: "Paper Moon", year: 1973, ids: { tmdb: 18131 } } }],
        "ratings-episodes.json": [
          { rating: 8, episode: { season: 1, number: 4 }, show: { title: "Missing", year: 2001, ids: { tmdb: 1396 } } },
        ],
      }),
    );
    const report = await applyImport(userId, parsed, createCatalogResolver());
    const [rating] = await db.select().from(ratings).where(eq(ratings.userId, userId));
    expect(rating?.score).toBe(9);
    expect(report.counts.ratings).toBe(0);
    expect(report.unmatched.map((row) => row.reason)).toContain("No season 1 on that show.");
  });

  it("deletes the file after the job and hides the report from another user", async () => {
    const userId = await user("owner");
    const otherId = await user("other");
    const bytes = zipOf({
      "watched-history-1.json": [
        { watched_at: "2014-01-01T00:00:00.000Z", type: "movie", movie: { title: "Paper Moon", year: 1973, ids: { tmdb: 18131 } } },
      ],
    });
    const jobId = await acceptImport(userId, bytes);
    expect(existsSync(importZipPath(jobId))).toBe(true);
    await expect(acceptImport(userId, bytes)).rejects.toMatchObject({ code: "import-busy" });
    await runImportJob(jobId);
    expect(existsSync(importZipPath(jobId))).toBe(false);
    const owned = await importForOwner(userId, jobId);
    expect(owned?.status).toBe("finished");
    expect(owned?.errorReport?.counts.plays).toBe(1);
    expect(await importForOwner(otherId, jobId)).toBeNull();
    const playRows = await getDb().select().from(plays).where(eq(plays.userId, userId));
    expect(playRows).toHaveLength(1);
    await deleteUserAccount(userId);
    const jobs = await getDb().select().from(importJobs).where(eq(importJobs.userId, userId));
    expect(jobs).toEqual([]);
  });

  it("rejects a path that escapes and still deletes the file", async () => {
    const userId = await user("slip");
    const name = Buffer.from("../watched-history-1.json");
    const data = strToU8("[]");
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);
    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(local.length + data.length, 42);
    name.copy(central, 46);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(central.length, 12);
    eocd.writeUInt32LE(local.length + data.length, 16);
    const jobId = await acceptImport(userId, Buffer.concat([local, data, central, eocd]));
    await runImportJob(jobId);
    const job = await importForOwner(userId, jobId);
    expect(job?.status).toBe("failed");
    expect(job?.errorReport?.failure).toMatch(/leaves the archive/);
    expect(existsSync(importZipPath(jobId))).toBe(false);
    expect(await getDb().select().from(plays)).toEqual([]);
  });
});
