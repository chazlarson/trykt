import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auth } from "./auth";
import { getDb } from "./db";
import { SIGNUP_LIMIT } from "./rate-limit";

describe("auth endpoint limits", () => {
  it("throttles sign-in and password reset when the login bucket is full", async () => {
    await getDb().execute(sql`
      insert into rate_counters (bucket_key, window_start, hits)
      values ('login:ip:local', now(), 10)
    `);
    const headers = new Headers();
    await expect(
      auth.api.signInEmail({
        body: { email: "nobody@example.com", password: "not-a-real-password" },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    await expect(
      auth.api.requestPasswordReset({
        body: { email: "nobody@example.com", redirectTo: "/reset-password" },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
    await expect(
      auth.api.resetPassword({
        body: { token: "not-a-token", newPassword: "not-a-real-password" },
        headers,
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
  });

  it("throttles direct sign-up when the signup bucket is full", async () => {
    await getDb().execute(sql`
      insert into rate_counters (bucket_key, window_start, hits)
      values ('signup:ip:local', now(), ${SIGNUP_LIMIT})
    `);
    await expect(
      auth.api.signUpEmail({
        body: {
          name: "ada",
          username: "ada",
          email: "ada@example.com",
          password: "not-a-real-password",
          callbackURL: "/sign-in",
        },
        headers: new Headers(),
      }),
    ).rejects.toMatchObject({ statusCode: 429 });
  });
});
