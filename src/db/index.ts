import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Database = PostgresJsDatabase<typeof schema>;

let cached: Database | undefined;

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return "postgres://trykt:trykt@127.0.0.1:5432/trykt";
  }
  throw new Error("DATABASE_URL is not set.");
}

export function getDb(): Database {
  if (cached) return cached;
  const url = databaseUrl();
  const testing = process.env.VITEST === "true";
  const client = postgres(url, {
    max: testing ? 1 : 10,
    idle_timeout: testing ? 1 : 20,
  });
  cached = drizzle(client, { schema });
  return cached;
}
