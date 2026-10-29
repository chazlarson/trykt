import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { TmdbError } from "./tmdb";
import { refreshCatalogTitle } from "./store";

type IdRow = { id: string };

async function ids(query: ReturnType<typeof sql>): Promise<string[]> {
  const rows = await getDb().execute<IdRow>(query);
  return rows.map((row) => row.id);
}

export async function showsDueForDailyRefresh(): Promise<string[]> {
  return ids(sql`
    select distinct t.id
    from titles t
    join episodes e on e.show_id = t.id
    join plays p on p.episode_id = e.id
    where t.kind = 'show'
      and t.status in ('Returning Series', 'In Production')
      and exists (
        select 1
        from episodes n
        where n.show_id = t.id
          and n.season_number > 0
          and (n.air_date is null or n.air_date <= current_date)
          and not exists (
            select 1 from plays p2
            where p2.episode_id = n.id
              and p2.user_id = p.user_id
          )
      )
  `);
}

export async function titlesDueForWeeklyRefresh(): Promise<string[]> {
  return ids(sql`
    select id from titles
    where fetched_at is null
       or fetched_at < now() - interval '14 days'
       or fetched_at < now() - interval '180 days'
  `);
}

export async function seasonsDueForWeeklyRefresh(): Promise<string[]> {
  return ids(sql`
    select s.show_id as id
    from seasons s
    join titles t on t.id = s.show_id
    where s.fetched_at is null
       or s.fetched_at < now() - interval '180 days'
       or (
         t.status in ('Returning Series', 'In Production')
         and s.fetched_at < now() - interval '24 hours'
       )
       or (
         t.status is null or t.status not in ('Returning Series', 'In Production')
       ) and s.fetched_at < now() - interval '30 days'
  `);
}

async function refreshIds(label: string, showIds: string[]) {
  const unique = [...new Set(showIds)];
  let refreshed = 0;
  let failed = 0;
  for (const id of unique) {
    try {
      await refreshCatalogTitle(id);
      refreshed += 1;
    } catch (error) {
      failed += 1;
      if (error instanceof TmdbError && error.code === "missing_key") {
        console.error("[trykt worker] TMDB_API_KEY is not set. Skipping catalog refresh.");
        return;
      }
      const code = error instanceof TmdbError ? error.code : "error";
      console.error(`[trykt worker] ${label} failed for ${id} (${code})`);
    }
  }
  console.info(`[trykt worker] ${label} refreshed ${refreshed} failed ${failed}`);
}

export async function runDailyRefresh() {
  await refreshIds("daily", await showsDueForDailyRefresh());
}

export async function runWeeklyRefresh() {
  const due = [...(await titlesDueForWeeklyRefresh()), ...(await seasonsDueForWeeklyRefresh())];
  await refreshIds("weekly", due);
  await getDb().execute(sql`
    delete from search_cache
    where fetched_at < now() - interval '180 days'
  `);
}
