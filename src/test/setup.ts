import { sql } from "drizzle-orm";
import { beforeEach } from "vitest";
import { getDb } from "../db";

beforeEach(async () => {
  await getDb().execute(sql`
    truncate table
      import_jobs,
      list_items,
      lists,
      plays,
      resume_points,
      watchlist_items,
      ratings,
      shelf_items,
      episodes,
      seasons,
      titles,
      search_cache,
      rate_counters,
      session,
      account,
      verification,
      "user"
    restart identity cascade
  `);
});
