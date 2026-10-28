import postgres from "postgres";
import { loadEnvFile } from "../load-env";
import { migrate } from "./migrate";

function databaseName(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  return decodeURIComponent(url.pathname.replace(/^\//, ""));
}

export async function resetDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
  const name = databaseName(databaseUrl);
  if (name !== "trykt" && name !== "trykt_test") {
    throw new Error(`Refusing to reset database "${name}".`);
  }
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`drop schema if exists public cascade`;
    await sql`drop schema if exists pgboss cascade`;
    await sql`create schema public`;
    await sql`grant all on schema public to public`;
  } finally {
    await sql.end();
  }
  await migrate(databaseUrl);
}

const invokedDirectly = process.argv[1]?.includes("src/db/reset");
if (invokedDirectly) {
  loadEnvFile();
  resetDatabase().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
