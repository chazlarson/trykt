import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { accounts, sessions, users, verifications } from "./db/schema";
import { getDb } from "./db";
import { deliverAuthMail } from "./mail";

function authSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NEXT_PHASE === "phase-production-build") {
    return "build-placeholder-not-a-real-session-secret";
  }
  throw new Error("BETTER_AUTH_SECRET must be at least 32 characters.");
}

export const auth = betterAuth({
  secret: authSecret(),
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:3000"],
  database: drizzleAdapter(getDb(), {
    provider: "pg",
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
    },
  }),
  user: {
    additionalFields: {
      username: {
        type: "string",
        required: true,
      },
      historyVisibility: {
        type: "string",
        required: false,
        defaultValue: "private",
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url, token }) => {
      await deliverAuthMail({
        kind: "password reset",
        to: user.email,
        code: token,
        url,
      });
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url, token }) => {
      await deliverAuthMail({
        kind: "verification",
        to: user.email,
        code: token,
        url,
      });
    },
  },
  rateLimit: {
    enabled: false,
  },
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
    defaultCookieAttributes: {
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    },
  },
  plugins: [nextCookies()],
});
