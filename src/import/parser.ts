import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";

export const PARSER_VERSION = "import_v1" as const;

export const ZIP_LIMITS = {
  maxZipBytes: 50 * 1024 * 1024,
  maxEntryBytes: 32 * 1024 * 1024,
  maxUnpackedBytes: 512 * 1024 * 1024,
  maxEntries: 2000,
};

export type ZipLimits = typeof ZIP_LIMITS;

const FUTURE_MS = 5 * 60 * 1000;

export class ZipRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipRejected";
  }
}

export type Ids = { tmdbId: number | null; imdbId: string | null };

export type Hint = { title: string; year: number | null };

export type PlayItem = Hint & {
  watchedAt: string;
  kind: "movie" | "episode";
  ids: Ids;
  episodeIds: Ids;
  seasonNumber: number | null;
  episodeNumber: number | null;
};

export type RatingItem = Hint & {
  ratedAt: string | null;
  score: number;
  subject: "movie" | "show" | "season" | "episode";
  ids: Ids;
  episodeIds: Ids;
  seasonNumber: number | null;
  episodeNumber: number | null;
  seasonTmdbId: number | null;
};

export type TitleItem = Hint & {
  kind: "movie" | "show";
  ids: Ids;
  at: string | null;
  note: string | null;
};

export type ShelfItem = Hint & {
  kind: "movie" | "episode";
  ids: Ids;
  episodeIds: Ids;
  seasonNumber: number | null;
  episodeNumber: number | null;
  at: string | null;
};

export type ParsedList = {
  name: string;
  description: string | null;
  items: TitleItem[];
};

export type Unmatched = { title: string; year: number | null; reason: string };

export type ParsedExport = {
  parser: typeof PARSER_VERSION;
  plays: PlayItem[];
  ratings: RatingItem[];
  watchlist: TitleItem[];
  lists: ParsedList[];
  shelf: ShelfItem[];
  unmatched: Unmatched[];
  files: { name: string; reason: string }[];
  notesSkipped: number;
};

type Kind =
  | "history"
  | "ratings-movies"
  | "ratings-shows"
  | "ratings-seasons"
  | "ratings-episodes"
  | "watchlist"
  | "favorites"
  | "list-meta"
  | "list-items"
  | "collection-movies"
  | "collection-shows"
  | "collection-episodes"
  | "comments";

type Classified = { kind: Kind; page: number; listKey?: string; listSlug?: string };

type Draft = { name: string; description: string | null; items: TitleItem[] };

type State = {
  recognized: boolean;
  plays: PlayItem[];
  ratings: RatingItem[];
  watchlist: TitleItem[];
  shelf: ShelfItem[];
  unmatched: Unmatched[];
  files: { name: string; reason: string }[];
  notesSkipped: number;
  drafts: Map<string, Draft>;
};

const EMPTY_IDS: Ids = { tmdbId: null, imdbId: null };

export function entryEscapes(name: string): boolean {
  if (!name || name.includes("\0") || name.includes(":")) return true;
  const normalized = name.replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.includes("//")) return true;
  return normalized.split("/").some((part) => part === "..");
}

export function parseExportZip(bytes: Uint8Array, limits: ZipLimits = ZIP_LIMITS): ParsedExport {
  if (bytes.length > limits.maxZipBytes) throw new ZipRejected("That file is over 50 MB.");
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ZipRejected("Upload a ZIP file.");
  const entries = readEntries(bytes, limits);
  entries.sort((left, right) => left.rank - right.rank || left.page - right.page || left.base.localeCompare(right.base));
  const state = emptyState();
  for (const entry of entries) {
    state.recognized = true;
    const rows = readList(entry.base, entry.bytes, state);
    if (!rows) continue;
    consume(state, entry, rows);
  }
  if (!state.recognized) {
    throw new ZipRejected("That ZIP has no history, ratings, watchlist, lists, or shelf entries.");
  }
  return {
    parser: PARSER_VERSION,
    plays: state.plays,
    ratings: state.ratings,
    watchlist: state.watchlist,
    lists: [...state.drafts.values()],
    shelf: state.shelf,
    unmatched: state.unmatched,
    files: state.files,
    notesSkipped: state.notesSkipped,
  };
}

function emptyState(): State {
  return {
    recognized: false,
    plays: [],
    ratings: [],
    watchlist: [],
    shelf: [],
    unmatched: [],
    files: [],
    notesSkipped: 0,
    drafts: new Map(),
  };
}

type ReadEntry = Classified & { base: string; bytes: Uint8Array; rank: number };

function readEntries(bytes: Uint8Array, limits: ZipLimits): ReadEntry[] {
  const entries: ReadEntry[] = [];
  let unpacked = 0;
  let seen = 0;
  let failure: ZipRejected | null = null;
  const uz = new Unzip();
  uz.register(UnzipInflate);
  uz.register(UnzipPassThrough);
  uz.onfile = (file) => {
    seen += 1;
    if (failure) {
      file.terminate();
      return;
    }
    if (seen > limits.maxEntries) {
      failure = new ZipRejected("That ZIP is too large to unpack.");
      file.terminate();
      return;
    }
    if (entryEscapes(file.name)) {
      failure = new ZipRejected("That ZIP contains a path that leaves the archive.");
      file.terminate();
      return;
    }
    if (file.name.endsWith("/")) {
      file.terminate();
      return;
    }
    const base = file.name.split("/").pop() ?? "";
    const classified = classifyName(base);
    if (!classified) {
      file.terminate();
      return;
    }
    if (file.originalSize !== undefined && file.originalSize > limits.maxEntryBytes) {
      failure = new ZipRejected("That ZIP is too large to unpack.");
      file.terminate();
      return;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, data, final) => {
      if (failure) return;
      if (error) {
        failure = new ZipRejected("That ZIP could not be read.");
        return;
      }
      size += data.length;
      unpacked += data.length;
      if (size > limits.maxEntryBytes || unpacked > limits.maxUnpackedBytes) {
        failure = new ZipRejected("That ZIP is too large to unpack.");
        file.terminate();
        return;
      }
      if (data.length > 0) chunks.push(data);
      if (final) {
        entries.push({
          ...classified,
          base,
          bytes: concat(chunks),
          rank: classified.kind === "list-meta" ? 0 : 1,
        });
      }
    };
    try {
      file.start();
    } catch {
      failure = new ZipRejected("That ZIP could not be read.");
    }
  };
  try {
    uz.push(bytes, true);
  } catch (error) {
    if (error instanceof ZipRejected) throw error;
    throw new ZipRejected("That ZIP could not be read.");
  }
  if (failure) throw failure;
  return entries;
}

function classifyName(base: string): Classified | null {
  const custom = /^lists-list-(\d+)-(.+)\.json$/.exec(base);
  if (custom?.[1] && custom[2]) return { kind: "list-items", page: 0, listKey: custom[1], listSlug: custom[2] };
  const pageOf = (stem: string): number | null => {
    if (base === `${stem}.json`) return 0;
    const prefix = `${stem}-`;
    if (!base.startsWith(prefix) || !base.endsWith(".json")) return null;
    const page = base.slice(prefix.length, -".json".length);
    return /^\d+$/.test(page) ? Number(page) : null;
  };
  const history = pageOf("watched-history");
  if (history !== null) return { kind: "history", page: history };
  const ratings = [
    ["ratings-movies", "ratings-movies"],
    ["ratings-shows", "ratings-shows"],
    ["ratings-seasons", "ratings-seasons"],
    ["ratings-episodes", "ratings-episodes"],
  ] as const;
  for (const [stem, kind] of ratings) {
    const page = pageOf(stem);
    if (page !== null) return { kind, page };
  }
  const watchlist = pageOf("lists-watchlist");
  if (watchlist !== null) return { kind: "watchlist", page: watchlist };
  const favorites = pageOf("lists-favorites");
  if (favorites !== null) return { kind: "favorites", page: favorites };
  const lists = pageOf("lists-lists");
  if (lists !== null) return { kind: "list-meta", page: lists };
  const movies = pageOf("collection-movies");
  if (movies !== null) return { kind: "collection-movies", page: movies };
  const shows = pageOf("collection-shows");
  if (shows !== null) return { kind: "collection-shows", page: shows };
  const episodes = pageOf("collection-episodes");
  if (episodes !== null) return { kind: "collection-episodes", page: episodes };
  for (const stem of ["comments-movies", "comments-shows", "comments-seasons", "comments-episodes", "comments-lists"]) {
    if (pageOf(stem) !== null) return { kind: "comments", page: pageOf(stem) ?? 0 };
  }
  return null;
}

function readList(base: string, bytes: Uint8Array, state: State): unknown[] | null {
  try {
    let text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value)) {
      state.files.push({ name: safeName(base), reason: "That file was not a list." });
      return null;
    }
    return value;
  } catch {
    state.files.push({ name: safeName(base), reason: "That file was not valid JSON." });
    return null;
  }
}

function consume(state: State, entry: ReadEntry, rows: unknown[]) {
  if (entry.kind === "comments") {
    state.notesSkipped += rows.length;
    return;
  }
  if (entry.kind === "history") {
    for (const row of rows) readHistory(state, row);
    return;
  }
  if (entry.kind === "ratings-movies") return readRatings(state, rows, "movie");
  if (entry.kind === "ratings-shows") return readRatings(state, rows, "show");
  if (entry.kind === "ratings-seasons") return readRatings(state, rows, "season");
  if (entry.kind === "ratings-episodes") return readRatings(state, rows, "episode");
  if (entry.kind === "watchlist") return readWatchlist(state, rows);
  if (entry.kind === "favorites") return readListItems(state, rows, draftFor(state, "favorites", "Favorites", null));
  if (entry.kind === "list-meta") return readListMeta(state, rows);
  if (entry.kind === "list-items" && entry.listKey) {
    const draft = draftFor(state, entry.listKey, nameFromSlug(entry.listSlug ?? ""), null);
    return readListItems(state, rows, draft);
  }
  if (entry.kind === "collection-movies") return readCollectionMovies(state, rows);
  if (entry.kind === "collection-shows") return readCollectionShows(state, rows);
  if (entry.kind === "collection-episodes") {
    for (const row of rows) readShelfEpisode(state, row);
  }
}

function readHistory(state: State, row: unknown) {
  const record = asRecord(row);
  if (!record) return;
  const movie = asRecord(record.movie);
  const episode = asRecord(record.episode);
  const show = asRecord(record.show);
  const watchedAt = timeOf(record.watched_at);
  if (movie && !episode) {
    const hint = titleOf(movie);
    if (!watchedAt) return miss(state, hint, "No watch time.");
    if (inFuture(watchedAt)) return miss(state, hint, "That time is still in the future.");
    const ids = externalIds(movie);
    if (!hasId(ids)) return miss(state, hint, "No TMDB or IMDb id.");
    state.plays.push({ ...hint, watchedAt, kind: "movie", ids, episodeIds: EMPTY_IDS, seasonNumber: null, episodeNumber: null });
    return;
  }
  if (episode || show) {
    const hint = titleOf(show) ;
    const episodeHint = titleOf(episode);
    const label = hint.title || episodeHint.title;
    const year = hint.year ?? episodeHint.year;
    const shown = { title: label, year };
    if (!watchedAt) return miss(state, shown, "No watch time.");
    if (inFuture(watchedAt)) return miss(state, shown, "That time is still in the future.");
    const seasonNumber = intOrNull(episode?.season);
    const episodeNumber = intOrNull(episode?.number);
    if (seasonNumber === null || episodeNumber === null || seasonNumber < 0 || episodeNumber < 0) {
      return miss(state, shown, "No season and episode number.");
    }
    const ids = externalIds(show);
    const episodeIds = externalIds(episode);
    if (!hasId(ids) && !hasId(episodeIds)) return miss(state, shown, "No TMDB or IMDb id.");
    state.plays.push({
      title: label,
      year,
      watchedAt,
      kind: "episode",
      ids,
      episodeIds,
      seasonNumber,
      episodeNumber,
    });
  }
}

function readRatings(state: State, rows: unknown[], subject: RatingItem["subject"]) {
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const score = intOrNull(record.rating);
    const movie = asRecord(record.movie);
    const show = asRecord(record.show);
    const season = asRecord(record.season);
    const episode = asRecord(record.episode);
    const media = subject === "movie" ? movie : show;
    const hint = titleOf(media);
    if (score === null || score < 1 || score > 10) {
      miss(state, hint, "Score is not between 1 and 10.");
      continue;
    }
    const seasonNumber = subject === "season" ? intOrNull(season?.number) : subject === "episode" ? intOrNull(episode?.season) : null;
    const episodeNumber = subject === "episode" ? intOrNull(episode?.number) : null;
    if (subject === "season" && (seasonNumber === null || seasonNumber < 0)) {
      miss(state, hint, "No season number.");
      continue;
    }
    if (subject === "episode" && (seasonNumber === null || episodeNumber === null || seasonNumber < 0 || episodeNumber < 0)) {
      miss(state, hint, "No season and episode number.");
      continue;
    }
    const ids = externalIds(media);
    const episodeIds = externalIds(episode);
    if (!hasId(ids) && !hasId(episodeIds)) {
      miss(state, hint, "No TMDB or IMDb id.");
      continue;
    }
    const ratedAt = timeOf(record.rated_at);
    state.ratings.push({
      ...hint,
      ratedAt: ratedAt && !inFuture(ratedAt) ? ratedAt : null,
      score,
      subject,
      ids,
      episodeIds,
      seasonNumber,
      episodeNumber,
      seasonTmdbId: subject === "season" ? externalIds(season).tmdbId : null,
    });
  }
}

function readWatchlist(state: State, rows: unknown[]) {
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const kind = record.type === "show" || (asRecord(record.show) && !asRecord(record.movie)) ? "show" : "movie";
    if (record.type === "season" || record.type === "episode" || record.type === "person") {
      const hint = titleOf(asRecord(record.show) ?? asRecord(record.movie) ?? asRecord(record.person));
      miss(state, hint, "The watchlist holds movies and shows.");
      continue;
    }
    const media = asRecord(kind === "movie" ? record.movie : record.show);
    const hint = titleOf(media);
    const ids = externalIds(media);
    if (!hasId(ids)) {
      miss(state, hint, "No TMDB or IMDb id.");
      continue;
    }
    state.watchlist.push({ ...hint, kind, ids, at: pastTime(record.listed_at), note: null });
  }
}

function readListMeta(state: State, rows: unknown[]) {
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const key = listJoinKey(asRecord(record.ids));
    const name = textField(record, "name").slice(0, 80);
    const description = textField(record, "description").slice(0, 500);
    if (key === null) {
      if (name) draftFor(state, `name:${name}`, name, description || null);
      continue;
    }
    draftFor(state, String(key), name || "List", description || null);
  }
}

function readListItems(state: State, rows: unknown[], draft: Draft) {
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    if (record.type === "season" || record.type === "episode" || record.type === "person") {
      const hint = titleOf(asRecord(record.show) ?? asRecord(record.movie) ?? asRecord(record.person));
      miss(state, hint, "Lists hold movies and shows.");
      continue;
    }
    const kind = record.type === "show" || (asRecord(record.show) && !asRecord(record.movie)) ? "show" : "movie";
    const media = asRecord(kind === "movie" ? record.movie : record.show);
    const hint = titleOf(media);
    const ids = externalIds(media);
    if (!hasId(ids)) {
      miss(state, hint, "No TMDB or IMDb id.");
      continue;
    }
    const note = textField(record, "notes").slice(0, 500);
    draft.items.push({ ...hint, kind, ids, at: pastTime(record.listed_at), note: note || null });
  }
}

function readCollectionMovies(state: State, rows: unknown[]) {
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const movie = asRecord(record.movie) ?? record;
    const hint = titleOf(movie);
    const ids = externalIds(movie);
    if (!hasId(ids)) {
      miss(state, hint, "No TMDB or IMDb id.");
      continue;
    }
    state.shelf.push({
      ...hint,
      kind: "movie",
      ids,
      episodeIds: EMPTY_IDS,
      seasonNumber: null,
      episodeNumber: null,
      at: pastTime(record.collected_at ?? record.last_collected_at),
    });
  }
}

function readCollectionShows(state: State, rows: unknown[]) {
  for (const row of rows) {
    const record = asRecord(row);
    if (!record) continue;
    const show = asRecord(record.show) ?? record;
    const hint = titleOf(show);
    const seasons = Array.isArray(record.seasons) ? record.seasons : [];
    let episodeRows = 0;
    for (const season of seasons) {
      const seasonRecord = asRecord(season);
      if (!seasonRecord) continue;
      const seasonNumber = intOrNull(seasonRecord.number);
      const episodes = Array.isArray(seasonRecord.episodes) ? seasonRecord.episodes : [];
      for (const episode of episodes) {
        const episodeRecord = asRecord(episode);
        if (!episodeRecord || seasonNumber === null || seasonNumber < 0) continue;
        const episodeNumber = intOrNull(episodeRecord.number);
        if (episodeNumber === null || episodeNumber < 0) continue;
        episodeRows += 1;
        const ids = externalIds(show);
        const episodeIds = externalIds(episodeRecord);
        if (!hasId(ids) && !hasId(episodeIds)) {
          miss(state, hint, "No TMDB or IMDb id.");
          continue;
        }
        state.shelf.push({
          ...hint,
          kind: "episode",
          ids,
          episodeIds,
          seasonNumber,
          episodeNumber,
          at: pastTime(episodeRecord.collected_at ?? record.last_collected_at ?? record.collected_at),
        });
      }
    }
    if (episodeRows === 0) miss(state, hint, "The shelf holds movies and episodes.");
  }
}

function readShelfEpisode(state: State, row: unknown) {
  const record = asRecord(row);
  if (!record) return;
  const episode = asRecord(record.episode) ?? record;
  const show = asRecord(record.show);
  const hint = titleOf(show ?? episode);
  const seasonNumber = intOrNull(episode.season);
  const episodeNumber = intOrNull(episode.number);
  if (seasonNumber === null || episodeNumber === null) {
    miss(state, hint, "No season and episode number.");
    return;
  }
  const ids = externalIds(show);
  const episodeIds = externalIds(episode);
  if (!hasId(ids) && !hasId(episodeIds)) {
    miss(state, hint, "No TMDB or IMDb id.");
    return;
  }
  state.shelf.push({
    ...hint,
    kind: "episode",
    ids,
    episodeIds,
    seasonNumber,
    episodeNumber,
    at: pastTime(record.collected_at ?? record.last_collected_at),
  });
}

function draftFor(state: State, key: string, name: string, description: string | null): Draft {
  const existing = state.drafts.get(key);
  if (existing) {
    if (existing.name === "List" && name && name !== "List") existing.name = name.slice(0, 80);
    if (!existing.description && description) existing.description = description;
    return existing;
  }
  const created = { name: (name || "List").slice(0, 80), description, items: [] };
  state.drafts.set(key, created);
  return created;
}

function nameFromSlug(slug: string): string {
  const cleaned = slug.replace(/\.json$/, "").replace(/[-_]+/g, " ").trim();
  return cleaned ? cleaned.slice(0, 80) : "List";
}

function miss(state: State, hint: Hint, reason: string) {
  state.unmatched.push({ title: hint.title || "Untitled", year: hint.year, reason });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function titleOf(record: Record<string, unknown> | null): Hint {
  if (!record) return { title: "", year: null };
  const title = (textField(record, "title") || textField(record, "name")).slice(0, 300);
  return { title, year: intOrNull(record.year) };
}

function externalIds(record: Record<string, unknown> | null): Ids {
  if (!record) return { tmdbId: null, imdbId: null };
  const ids = asRecord(record.ids);
  if (!ids) return { tmdbId: null, imdbId: null };
  const tmdb = positiveInt(ids.tmdb);
  const imdb = textField(ids, "imdb");
  return { tmdbId: tmdb, imdbId: /^tt\d{5,12}$/.test(imdb) ? imdb : null };
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function positiveInt(value: unknown): number | null {
  const parsed = intOrNull(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function listJoinKey(ids: Record<string, unknown> | null): string | null {
  if (!ids) return null;
  for (const [key, value] of Object.entries(ids)) {
    if (key === "tmdb" || key === "imdb" || key === "slug") continue;
    const parsed = positiveInt(value);
    if (parsed !== null) return String(parsed);
  }
  return null;
}

function hasId(ids: Ids): boolean {
  return ids.tmdbId !== null || ids.imdbId !== null;
}

function timeOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function pastTime(value: unknown): string | null {
  const time = timeOf(value);
  if (!time || inFuture(time)) return null;
  return time;
}

function inFuture(iso: string): boolean {
  return new Date(iso).getTime() > Date.now() + FUTURE_MS;
}

function safeName(name: string): string {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 120);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
