import { PgBoss } from "pg-boss";
import { runDailyRefresh, runWeeklyRefresh } from "./catalog/refresh";
import { loadEnvFile } from "./load-env";

const DAILY = "catalog-daily";
const WEEKLY = "catalog-weekly";

async function main() {
  loadEnvFile();
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const boss = new PgBoss(url);
  boss.on("error", (error: unknown) => {
    console.error("[trykt worker]", error instanceof Error ? error.message : error);
  });
  await boss.start();
  await boss.createQueue(DAILY, { retryLimit: 2, retryDelay: 60 });
  await boss.createQueue(WEEKLY, { retryLimit: 2, retryDelay: 60 });
  await boss.work(DAILY, async () => {
    await runDailyRefresh();
  });
  await boss.work(WEEKLY, async () => {
    await runWeeklyRefresh();
  });
  await boss.schedule(DAILY, "0 4 * * *");
  await boss.schedule(WEEKLY, "30 4 * * 0");
  console.info("[trykt worker] listening");

  const stop = async () => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void stop();
  });
  process.on("SIGTERM", () => {
    void stop();
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
