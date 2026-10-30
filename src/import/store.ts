import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { AppError } from "../errors";
import { getDb } from "../db";
import { importJobs, type ImportErrorReport } from "../db/schema";
import { takeToken } from "../rate-limit";
import { ZIP_LIMITS, ZipRejected } from "./parser";

const ROOT = path.join(process.cwd(), "data", "imports");
const IMPORT_LIMIT = 10;
const IMPORT_WINDOW_SECONDS = 60 * 60;

export function importZipPath(jobId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new ZipRejected("That ZIP could not be read.");
  }
  const file = path.resolve(ROOT, `${jobId}.zip`);
  if (path.dirname(file) !== path.resolve(ROOT)) throw new ZipRejected("That ZIP could not be read.");
  return file;
}

export async function loadImport(jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const [row] = await getDb().select().from(importJobs).where(eq(importJobs.id, jobId));
  return row ?? null;
}

export async function latestImport(userId: string) {
  const [row] = await getDb()
    .select()
    .from(importJobs)
    .where(eq(importJobs.userId, userId))
    .orderBy(desc(importJobs.createdAt))
    .limit(1);
  return row ?? null;
}

export async function importForOwner(userId: string, jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const [row] = await getDb()
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.id, jobId), eq(importJobs.userId, userId)));
  return row ?? null;
}

export async function acceptImport(userId: string, bytes: Uint8Array): Promise<string> {
  if (bytes.length > ZIP_LIMITS.maxZipBytes) throw new AppError("import-size");
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new AppError("import-type");
  const db = getDb();
  const [busy] = await db
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(and(eq(importJobs.userId, userId), inArray(importJobs.status, ["queued", "running"])))
    .limit(1);
  if (busy) throw new AppError("import-busy");
  const allowed = await takeToken(`import:user:${userId}`, IMPORT_WINDOW_SECONDS, IMPORT_LIMIT);
  if (!allowed) throw new AppError("import-rate");
  const [job] = await db
    .insert(importJobs)
    .values({ userId, status: "queued", parser: "import_v1" })
    .returning({ id: importJobs.id });
  if (!job) throw new AppError("import-failed");
  try {
    await mkdir(ROOT, { recursive: true, mode: 0o700 });
    const destination = importZipPath(job.id);
    const temporary = `${destination}.partial`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, destination);
  } catch (error) {
    await rm(`${importZipPath(job.id)}.partial`, { force: true }).catch(() => undefined);
    await markFailed(job.id, "Import failed. Try the file again.");
    throw error instanceof AppError ? error : new AppError("import-failed");
  }
  return job.id;
}

export async function setImportProgress(jobId: string, done: number, total: number) {
  await getDb()
    .update(importJobs)
    .set({ progressDone: done, progressTotal: total })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "running")));
}

export async function markRunning(jobId: string) {
  await getDb()
    .update(importJobs)
    .set({ status: "running" })
    .where(and(eq(importJobs.id, jobId), inArray(importJobs.status, ["queued", "running"])));
}

export async function markFinished(jobId: string, report: ImportErrorReport) {
  await getDb()
    .update(importJobs)
    .set({ status: "finished", errorReport: report, finishedAt: new Date() })
    .where(and(eq(importJobs.id, jobId), eq(importJobs.status, "running")));
}

export async function markFailed(jobId: string, failure: string) {
  const report: ImportErrorReport = {
    parser: "import_v1",
    failure,
    unmatched: [],
    counts: { plays: 0, ratings: 0, watchlist: 0, lists: 0, list_items: 0, shelf: 0, notes_skipped: 0 },
    files: [],
  };
  await getDb()
    .update(importJobs)
    .set({ status: "failed", errorReport: report, finishedAt: new Date() })
    .where(and(eq(importJobs.id, jobId), inArray(importJobs.status, ["queued", "running", "failed"])));
}

const REMOVED = "The file was already removed.";
const CLEARED = "Import cleared.";

export async function importsToResume(): Promise<string[]> {
  const rows = await getDb()
    .select({ id: importJobs.id, cancelRequested: importJobs.cancelRequested })
    .from(importJobs)
    .where(inArray(importJobs.status, ["queued", "running"]));
  const resume: string[] = [];
  for (const row of rows) {
    if (row.cancelRequested) {
      await markFailed(row.id, CLEARED);
      await deleteImportFiles([row.id]);
      continue;
    }
    if (!existsSync(importZipPath(row.id))) {
      await markFailed(row.id, REMOVED);
      continue;
    }
    resume.push(row.id);
  }
  if (resume.length > 0) {
    await getDb()
      .update(importJobs)
      .set({ status: "queued", progressDone: 0, progressTotal: 0, cancelRequested: false })
      .where(and(inArray(importJobs.id, resume), inArray(importJobs.status, ["queued", "running"])));
  }
  return resume;
}

export async function clearImports(userId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ id: importJobs.id })
    .from(importJobs)
    .where(and(eq(importJobs.userId, userId), inArray(importJobs.status, ["queued", "running"])));
  for (const row of rows) {
    await withJobLock(
      row.id,
      async () => {
        await getDb()
          .update(importJobs)
          .set({ cancelRequested: true })
          .where(and(eq(importJobs.id, row.id), inArray(importJobs.status, ["queued", "running"])));
      },
      async () => {
        await markFailed(row.id, CLEARED);
        await deleteImportFiles([row.id]);
      },
    );
  }
  return rows.map((row) => row.id);
}

export async function failClearedImport(jobId: string) {
  const current = await loadImport(jobId);
  if (!current || (current.status !== "queued" && current.status !== "running")) return;
  await markFailed(jobId, CLEARED);
}

async function withJobLock(jobId: string, whenBusy: () => Promise<void>, whenIdle: () => Promise<void>) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    await whenIdle();
    return;
  }
  const sql = postgres(url, { max: 1 });
  let locked = false;
  try {
    const [row] = await sql<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtextextended(${jobId}, 0)) as locked`;
    locked = Boolean(row?.locked);
    if (!locked) {
      await whenBusy();
      return;
    }
    await whenIdle();
  } finally {
    if (locked) await sql`select pg_advisory_unlock(hashtextextended(${jobId}, 0))`;
    await sql.end({ timeout: 5 });
  }
}

export async function deleteImportFiles(jobIds: string[]) {
  await Promise.all(jobIds.map(async (jobId) => {
    try {
      await rm(importZipPath(jobId), { force: true });
      await rm(`${importZipPath(jobId)}.partial`, { force: true });
    } catch {
      // A missing file is already the state we want.
    }
  }));
}
