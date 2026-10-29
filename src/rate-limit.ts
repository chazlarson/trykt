import { sql } from "drizzle-orm";
import { getDb } from "./db";

export const TMDB_USER_LIMIT = 30;
export const TMDB_USER_WINDOW_SECONDS = 60;
export const SIGNUP_LIMIT = 5;
export const SIGNUP_WINDOW_SECONDS = 60 * 60;
export const LOGIN_LIMIT = 10;
export const LOGIN_WINDOW_SECONDS = 15 * 60;

export function clientAddress(headerList: Headers): string {
  const forwarded = headerList.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || headerList.get("x-real-ip") || "local";
  return ip.slice(0, 80);
}

export async function takeToken(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const db = getDb();
  const rows = await db.execute<{ hits: number }>(sql`
    insert into rate_counters (bucket_key, window_start, hits)
    values (${key}, now(), 1)
    on conflict (bucket_key) do update set
      hits = case
        when rate_counters.window_start + (${windowSeconds}::int * interval '1 second') <= now() then 1
        else rate_counters.hits + 1
      end,
      window_start = case
        when rate_counters.window_start + (${windowSeconds}::int * interval '1 second') <= now() then now()
        else rate_counters.window_start
      end
    returning hits
  `);
  const first = rows[0];
  const hits = Number(first?.hits ?? max + 1);
  return hits <= max;
}
