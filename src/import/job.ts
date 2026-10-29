import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import postgres from "postgres";
import { applyImport } from "./apply";
import { parseExportZip, ZipRejected } from "./parser";
import { createCatalogResolver } from "./resolve";
import { importZipPath, loadImport, markFailed, markFinished, markRunning } from "./store";

export async function runImportJob(jobId: string) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(url, { max: 1 });
  let locked = false;
  try {
    const [row] = await sql<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtextextended(${jobId}, 0)) as locked`;
    locked = Boolean(row?.locked);
    if (!locked) return;
    await runUnlocked(jobId);
  } finally {
    if (locked) await sql`select pg_advisory_unlock(hashtextextended(${jobId}, 0))`;
    await sql.end({ timeout: 5 });
  }
}

async function runUnlocked(jobId: string) {
  const job = await loadImport(jobId);
  if (!job || job.status === "finished" || job.status === "failed") return;
  const file = importZipPath(jobId);
  if (!existsSync(file)) {
    await markFailed(jobId, "The file was already removed.");
    return;
  }
  await markRunning(jobId);
  let remove = false;
  try {
    const bytes = new Uint8Array(await readFile(file));
    const parsed = parseExportZip(bytes);
    const report = await applyImport(job.userId, parsed, createCatalogResolver());
    await markFinished(jobId, report);
    remove = true;
  } catch (error) {
    if (error instanceof ZipRejected) {
      await markFailed(jobId, error.message);
      remove = true;
      return;
    }
    throw error;
  } finally {
    if (remove) await rm(file, { force: true });
  }
}
