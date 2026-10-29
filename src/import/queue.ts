import { PgBoss } from "pg-boss";

export const IMPORT_QUEUE = "import-zip";

type ImportPayload = { jobId: string };

let starting: Promise<PgBoss> | null = null;

async function client(): Promise<PgBoss> {
  if (!starting) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set.");
    const boss = new PgBoss(url);
    boss.on("error", (error: unknown) => {
      console.error("[trykt] import queue", error instanceof Error ? error.message : "queue error");
    });
    starting = boss.start().then(async () => {
      await boss.createQueue(IMPORT_QUEUE);
      return boss;
    });
  }
  return starting;
}

export async function enqueueImport(jobId: string) {
  const boss = await client();
  await boss.send(IMPORT_QUEUE, { jobId } satisfies ImportPayload, {
    retryLimit: 2,
    retryDelay: 30,
    expireInSeconds: 60 * 60 * 6,
    singletonKey: jobId,
  });
}
