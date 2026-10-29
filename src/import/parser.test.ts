import { crc32 } from "node:zlib";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { entryEscapes, parseExportZip, ZIP_LIMITS, ZipRejected } from "./parser";

const foreignKey = "trakt";
const foreignId = 918273645;
const foreignSlug = "quiet-slate-name";

function zipOf(files: Record<string, unknown | string>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [name, value] of Object.entries(files)) {
    entries[name] = strToU8(typeof value === "string" ? value : JSON.stringify(value));
  }
  return zipSync(entries);
}

function storedZip(name: string, data: Uint8Array): Uint8Array {
  const filename = Buffer.from(name, "utf8");
  const crc = crc32(data) >>> 0;
  const local = Buffer.alloc(30 + filename.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(filename.length, 26);
  filename.copy(local, 30);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(0, 42);
  filename.copy(central, 46);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(local.length + data.length, 16);
  return Buffer.concat([local, data, central, eocd]);
}

const movie = {
  title: "Paper Moon",
  year: 1973,
  ids: { [foreignKey]: foreignId, slug: foreignSlug, imdb: "tt0070510", tmdb: 18131, tvdb: 555001, tvrage: 777002 },
};

describe("parseExportZip", () => {
  it("keeps TMDB and IMDb ids and drops every other id", () => {
    const parsed = parseExportZip(
      zipOf({
        "notes/watched-history-1.json": [
          {
            id: foreignId,
            watched_at: "2014-10-01T01:00:00.000Z",
            action: "scrobble",
            type: "movie",
            movie,
          },
          {
            id: foreignId + 1,
            watched_at: "2015-01-02T03:00:00.000Z",
            action: "watch",
            type: "episode",
            episode: { title: "Pilot", season: 1, number: 1, ids: { [foreignKey]: 42, tmdb: 100 } },
            show: { title: "Example Show", year: 2008, ids: { [foreignKey]: 7, tmdb: 1396, imdb: "tt0903747" } },
          },
        ],
        "ratings-movies.json": [{ rated_at: "2014-10-02T00:00:00.000Z", rating: 8, movie }],
        "ratings-shows.json": [{ rating: 7, show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } } }],
        "ratings-seasons.json": [
          { rating: 9, season: { number: 1, ids: { tmdb: 3572, [foreignKey]: 3 } }, show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } } },
        ],
        "ratings-episodes.json": [
          {
            rating: 10,
            episode: { season: 1, number: 2, ids: { imdb: "tt0000001" } },
            show: { title: "Example Show", year: 2008, ids: { imdb: "tt0903747" } },
          },
        ],
        "lists-watchlist.json": [{ rank: 1, listed_at: "2014-09-01T00:00:00.000Z", type: "movie", movie }],
        "lists-favorites.json": [{ type: "show", show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } } }],
        "lists-lists.json": [{ name: "Sunday shelf", description: "Quiet titles", ids: { [foreignKey]: foreignId, slug: foreignSlug } }],
        [`lists-list-${foreignId}-${foreignSlug}.json`]: [{ type: "movie", notes: "rewatch later", movie }],
        "collection-movies.json": [{ collected_at: "2014-08-01T00:00:00.000Z", movie }],
        "collection-shows.json": [
          {
            show: { title: "Example Show", year: 2008, ids: { tmdb: 1396 } },
            seasons: [{ number: 1, episodes: [{ number: 1, collected_at: "2014-08-02T00:00:00.000Z" }] }],
          },
        ],
        "comments-movies.json": [{ comment: { comment: "secret note about a hospital" }, movie }],
        "followers.json": [{ user: { ids: { [foreignKey]: foreignId } } }],
        "watched-shows.json": [{ show: { title: "Should be ignored", ids: { tmdb: 1 } } }],
      }),
    );
    const encoded = JSON.stringify(parsed);
    expect(parsed.parser).toBe("import_v1");
    expect(encoded).not.toContain(String(foreignId));
    expect(encoded).not.toContain(foreignSlug);
    expect(encoded).not.toContain(foreignKey);
    expect(encoded).not.toContain("tvdb");
    expect(encoded).not.toContain("555001");
    expect(encoded).not.toContain("secret note about a hospital");
    expect(encoded).not.toContain("Should be ignored");
    expect(parsed.plays.map((play) => play.title)).toEqual(["Paper Moon", "Example Show"]);
    expect(parsed.plays[0]).toMatchObject({ kind: "movie", ids: { tmdbId: 18131, imdbId: "tt0070510" } });
    expect(parsed.plays[1]).toMatchObject({ kind: "episode", seasonNumber: 1, episodeNumber: 1, ids: { tmdbId: 1396 } });
    expect(parsed.ratings.map((rating) => rating.subject).sort()).toEqual(["episode", "movie", "season", "show"]);
    expect(parsed.ratings.find((rating) => rating.subject === "season")?.seasonTmdbId).toBe(3572);
    expect(parsed.watchlist).toHaveLength(1);
    expect(parsed.lists.map((list) => list.name)).toEqual(["Sunday shelf", "Favorites"]);
    expect(parsed.lists[0]?.items[0]?.note).toBe("rewatch later");
    expect(parsed.shelf.map((item) => item.kind)).toEqual(["movie", "episode"]);
    expect(parsed.notesSkipped).toBe(1);
    expect(parsed.lists[0]?.description).toBe("Quiet titles");
  });

  it("reads paginated files in numeric order and a folder prefix", () => {
    const parsed = parseExportZip(
      zipOf({
        "Export/watched-history-2.json": [{ watched_at: "2014-02-01T00:00:00.000Z", type: "movie", movie: { title: "Second", year: 2000, ids: { tmdb: 2 } } }],
        "Export/watched-history-10.json": [{ watched_at: "2014-03-01T00:00:00.000Z", type: "movie", movie: { title: "Tenth", year: 2000, ids: { tmdb: 10 } } }],
        "watched-history-1.json": [{ watched_at: "2014-01-01T00:00:00.000Z", type: "movie", movie: { title: "First", year: 1999, ids: { tmdb: 1 } } }],
        "ratings-movies-2.json": [{ rating: 9, movie: { title: "Later", year: 2010, ids: { tmdb: 9 } } }],
        "ratings-movies-1.json": [{ rating: 8, movie: { title: "Earlier", year: 2009, ids: { tmdb: 8 } } }],
      }),
    );
    expect(parsed.plays.map((play) => play.title)).toEqual(["First", "Second", "Tenth"]);
    expect(parsed.ratings.map((rating) => rating.title)).toEqual(["Earlier", "Later"]);
  });

  it("records rows that cannot be matched and keeps going after a bad file", () => {
    const parsed = parseExportZip(
      zipOf({
        "watched-history-1.json": [
          { watched_at: "2014-01-01T00:00:00.000Z", type: "movie", movie: { title: "No ids", year: 1990 } },
          { type: "movie", movie: { title: "No time", year: 1991, ids: { tmdb: 1 } } },
          { watched_at: "2999-01-01T00:00:00.000Z", type: "movie", movie: { title: "Future", year: 1992, ids: { tmdb: 1 } } },
          { watched_at: "2014-01-01T00:00:00.000Z", type: "episode", show: { title: "No numbers", year: 2001, ids: { tmdb: 2 } } },
        ],
        "ratings-movies.json": "{",
        "lists-watchlist.json": [{ type: "episode", show: { title: "One episode", year: 2012, ids: { tmdb: 3 } } }],
        "collection-shows.json": [{ show: { title: "Whole show", year: 2011, ids: { tmdb: 4 } } }],
        "ratings-shows.json": [{ rating: 11, show: { title: "Too high", year: 2000, ids: { tmdb: 5 } } }],
      }),
    );
    expect(parsed.plays).toHaveLength(0);
    expect(parsed.unmatched.map((row) => row.reason).sort()).toEqual(
      [
        "No TMDB or IMDb id.",
        "No watch time.",
        "That time is still in the future.",
        "No season and episode number.",
        "The watchlist holds movies and shows.",
        "The shelf holds movies and episodes.",
        "Score is not between 1 and 10.",
      ].sort(),
    );
    expect(parsed.files).toEqual([{ name: "ratings-movies.json", reason: "That file was not valid JSON." }]);
  });

  it("rejects archives that leave the zip, are not zips, or are too large", () => {
    expect(entryEscapes("../x.json")).toBe(true);
    expect(entryEscapes("/tmp/x.json")).toBe(true);
    expect(entryEscapes("Export/watched-history-1.json")).toBe(false);
    expect(() => parseExportZip(storedZip("../watched-history-1.json", strToU8("[]")))).toThrow(ZipRejected);
    expect(() => parseExportZip(storedZip("/tmp/watched-history-1.json", strToU8("[]")))).toThrow(/leaves the archive/);
    expect(() => parseExportZip(strToU8("not a zip"))).toThrow(/ZIP file/);
    expect(() => parseExportZip(zipOf({ "followers.json": [] }))).toThrow(/no history/);
    const bulky = zipOf({ "watched-history-1.json": " ".repeat(200) });
    expect(() =>
      parseExportZip(bulky, { ...ZIP_LIMITS, maxEntryBytes: 50, maxUnpackedBytes: 50 }),
    ).toThrow(/too large to unpack/);
    expect(ZIP_LIMITS.maxZipBytes).toBe(50 * 1024 * 1024);
  });
});
