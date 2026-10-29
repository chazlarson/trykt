import path from "node:path";
import { defineConfig } from "vitest/config";

const databaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgres://trykt:trykt@127.0.0.1:5432/trykt_test";

process.env.TEST_DATABASE_URL = databaseUrl;
process.env.DATABASE_URL = databaseUrl;
process.env.TMDB_API_KEY ??= "test-key";
process.env.BETTER_AUTH_SECRET ??= "test-secret-test-secret-test-secret-32";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup.ts"],
    env: {
      DATABASE_URL: databaseUrl,
      TEST_DATABASE_URL: databaseUrl,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-32",
      BETTER_AUTH_URL: "http://localhost:3000",
      TMDB_API_KEY: "test-key",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
