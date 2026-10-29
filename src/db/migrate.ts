import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { loadEnvFile } from "../load-env";

function statements(sqlText: string): string[] {
  return sqlText
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export async function migrate(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(databaseUrl, { max: 1 });
  try {
    await sql`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    const dir = path.join(process.cwd(), "src/db/migrations");
    const files = (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort();
    for (const file of files) {
      const done = await sql`select 1 from schema_migrations where filename = ${file}`;
      if (done.length > 0) continue;
      const body = await readFile(path.join(dir, file), "utf8");
      const parts = statements(body);
      await sql.begin(async (tx) => {
        for (const statement of parts) {
          await tx.unsafe(statement);
        }
        await tx`insert into schema_migrations (filename) values (${file})`;
      });
      console.info(`applied ${file}`);
    }
  } finally {
    await sql.end();
  }
}

const invokedDirectly = process.argv[1]?.includes("src/db/migrate");
if (invokedDirectly) {
  loadEnvFile();
  migrate().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
