import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const users = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    username: citext("username").notNull().unique(),
    historyVisibility: text("history_visibility").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "user_history_visibility_chk",
      sql`${table.historyVisibility} in ('private', 'followers', 'public')`,
    ),
  ],
);

export const sessions = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verifications = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const titles = pgTable(
  "titles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    imdbId: text("imdb_id"),
    name: text("name").notNull(),
    year: integer("year"),
    overview: text("overview"),
    posterPath: text("poster_path"),
    backdropPath: text("backdrop_path"),
    runtimeMin: integer("runtime_min"),
    status: text("status"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    unavailableAt: timestamp("unavailable_at", { withTimezone: true }),
  },
  (table) => [
    unique("titles_kind_tmdb_uidx").on(table.kind, table.tmdbId),
    check("titles_kind_chk", sql`${table.kind} in ('movie', 'show')`),
  ],
);

export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      .references(() => titles.id),
    seasonNumber: integer("season_number").notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    name: text("name").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  },
  (table) => [unique("seasons_show_number_uidx").on(table.showId, table.seasonNumber)],
);

export const episodes = pgTable(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      .references(() => titles.id),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id),
    seasonNumber: integer("season_number").notNull(),
    episodeNumber: integer("episode_number").notNull(),
    tmdbId: integer("tmdb_id").notNull(),
    name: text("name").notNull(),
    overview: text("overview"),
    airDate: date("air_date"),
    runtimeMin: integer("runtime_min"),
    stillPath: text("still_path"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  },
  (table) => [
    unique("episodes_show_number_uidx").on(table.showId, table.seasonNumber, table.episodeNumber),
    index("episodes_season_id_idx").on(table.seasonId),
  ],
);

export const plays = pgTable(
  "plays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    movieId: uuid("movie_id").references(() => titles.id),
    episodeId: uuid("episode_id").references(() => episodes.id),
    watchedAt: timestamp("watched_at", { withTimezone: true }).notNull(),
    source: text("source").notNull(),
    playbackSessionId: uuid("playback_session_id"),
    rewatch: boolean("rewatch").notNull().default(false),
  },
  (table) => [
    index("plays_user_watched_idx").on(table.userId, table.watchedAt),
    check("plays_source_chk", sql`${table.source} in ('manual', 'bulk', 'playback', 'import')`),
    check(
      "plays_one_subject_chk",
      sql`((${table.movieId} is not null)::int + (${table.episodeId} is not null)::int) = 1`,
    ),
  ],
);

export const resumePoints = pgTable(
  "resume_points",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    movieId: uuid("movie_id").references(() => titles.id),
    episodeId: uuid("episode_id").references(() => episodes.id),
    position: numeric("position", { precision: 4, scale: 3 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check("resume_position_chk", sql`${table.position} >= 0 and ${table.position} <= 1`),
    check(
      "resume_one_subject_chk",
      sql`((${table.movieId} is not null)::int + (${table.episodeId} is not null)::int) = 1`,
    ),
  ],
);

export const watchlistItems = pgTable(
  "watchlist_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    movieId: uuid("movie_id").references(() => titles.id),
    showId: uuid("show_id").references(() => titles.id),
    position: integer("position").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "watchlist_one_subject_chk",
      sql`((${table.movieId} is not null)::int + (${table.showId} is not null)::int) = 1`,
    ),
  ],
);

export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id),
    name: text("name").notNull(),
    description: text("description"),
    visibility: text("visibility").notNull().default("private"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("lists_owner_idx").on(table.ownerId),
    check("lists_visibility_chk", sql`${table.visibility} in ('private', 'followers', 'public')`),
  ],
);

export const listItems = pgTable(
  "list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => lists.id),
    movieId: uuid("movie_id").references(() => titles.id),
    showId: uuid("show_id").references(() => titles.id),
    position: integer("position").notNull(),
    note: text("note"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "list_items_one_subject_chk",
      sql`((${table.movieId} is not null)::int + (${table.showId} is not null)::int) = 1`,
    ),
  ],
);

export const ratings = pgTable(
  "ratings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    score: integer("score").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    unique("ratings_user_subject_uidx").on(table.userId, table.subjectType, table.subjectId),
    check(
      "ratings_subject_chk",
      sql`${table.subjectType} in ('movie', 'show', 'season', 'episode')`,
    ),
    check("ratings_score_chk", sql`${table.score} between 1 and 10`),
  ],
);

export const shelfItems = pgTable(
  "shelf_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    movieId: uuid("movie_id").references(() => titles.id),
    episodeId: uuid("episode_id").references(() => episodes.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      "shelf_one_subject_chk",
      sql`((${table.movieId} is not null)::int + (${table.episodeId} is not null)::int) = 1`,
    ),
  ],
);

export type SearchHit = { kind: "movie" | "show"; tmdbId: number };

export const searchCache = pgTable("search_cache", {
  query: text("query").primaryKey(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  hits: jsonb("hits").$type<SearchHit[]>().notNull(),
});

export const rateCounters = pgTable("rate_counters", {
  bucketKey: text("bucket_key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  hits: integer("hits").notNull(),
});

export type TitleKind = "movie" | "show";
export type PlaySource = "manual" | "bulk" | "playback" | "import";
export type RatingSubject = "movie" | "show" | "season" | "episode";
