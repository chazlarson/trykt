import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import postgres from "postgres";
import { applyImport, ImportStopped } from "./apply";
import { parseExportZip, ZipRejected } from "./parser";
import { createCatalogResolver } from "./resolve";
import {
  deleteImportFiles,
  failClearedImport,
  importZipPath,
  importsToResume,
  loadImport,
  markFailed,
  markFinished,
  markRunning,
  setImportProgress,
} from "./store";

export type ImportAttempt = {
  retryCount: number;
  retryLimit: number;
};

const EXHAUSTED = "Import failed. Try the file again.";

export async function runImportJob(jobId: string, attempt: ImportAttempt = { retryCount: 0, retryLimit: 0 }) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set.");
  const sql = postgres(url, { max: 1 });
  let locked = false;
  try {
    const [row] = await sql<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtextextended(${jobId}, 0)) as locked`;
    locked = Boolean(row?.locked);
    if (!locked) return;
    await runUnlocked(jobId, attempt);
  } finally {
    if (locked) await sql`select pg_advisory_unlock(hashtextextended(${jobId}, 0))`;
    await sql.end({ timeout: 5 });
  }
}

async function runUnlocked(jobId: string, attempt: ImportAttempt) {
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
    const report = await applyImport(job.userId, parsed, createCatalogResolver(), progressFor(jobId), () => stillOpen(jobId));
    if (!(await stillOpen(jobId))) {
      await failClearedImport(jobId);
      remove = true;
      return;
    }
    await markFinished(jobId, report);
    remove = true;
  } catch (error) {
    if (error instanceof ImportStopped) {
      await failClearedImport(jobId);
      remove = true;
      return;
    }
    if (!(await stillOpen(jobId))) {
      await failClearedImport(jobId);
      remove = true;
      return;
    }
    if (error instanceof ZipRejected) {
      await markFailed(jobId, error.message);
      remove = true;
      return;
    }
    if (attempt.retryCount < attempt.retryLimit) throw error;
    await markFailed(jobId, EXHAUSTED);
    remove = true;
  } finally {
    if (remove) await rm(file, { force: true });
  }
}

export async function resumeImports(enqueue: (jobId: string) => Promise<string | null>): Promise<void> {
  for (const jobId of await importsToResume()) {
    let sent: string | null = null;
    try {
      sent = await enqueue(jobId);
    } catch {
      sent = null;
    }
    if (sent) continue;
    await markFailed(jobId, EXHAUSTED);
    await deleteImportFiles([jobId]);
  }
}

async function stillOpen(jobId: string): Promise<boolean> {
  const current = await loadImport(jobId);
  return Boolean(current && (current.status === "queued" || current.status === "running") && !current.cancelRequested);
}

function progressFor(jobId: string) {
  let lastDone = -1;
  let lastAt = 0;
  return async (done: number, total: number) => {
    const now = Date.now();
    const due = lastDone < 0 || done === total || done - lastDone >= 25 || now - lastAt >= 500;
    if (!due) return;
    lastDone = done;
    lastAt = now;
    await setImportProgress(jobId, done, total);
  };
}
