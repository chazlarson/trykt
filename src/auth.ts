import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { accounts, sessions, users, verifications } from "./db/schema";
import { getDb } from "./db";
import { deliverAuthMail } from "./mail";
import {
  clientAddress,
  LOGIN_LIMIT,
  LOGIN_WINDOW_SECONDS,
  SIGNUP_LIMIT,
  SIGNUP_WINDOW_SECONDS,
  takeToken,
} from "./rate-limit";

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
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const limit =
        ctx.path === "/sign-up/email"
          ? { bucket: "signup", windowSeconds: SIGNUP_WINDOW_SECONDS, max: SIGNUP_LIMIT }
          : ctx.path === "/sign-in/email" ||
              ctx.path === "/request-password-reset" ||
              ctx.path === "/reset-password"
            ? { bucket: "login", windowSeconds: LOGIN_WINDOW_SECONDS, max: LOGIN_LIMIT }
            : null;
      if (!limit) return;
      const headers = ctx.headers instanceof Headers ? ctx.headers : new Headers();
      const allowed = await takeToken(
        `${limit.bucket}:ip:${clientAddress(headers)}`,
        limit.windowSeconds,
        limit.max,
      );
      if (!allowed) throw new APIError("TOO_MANY_REQUESTS", { message: "Too many attempts." });
    }),
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
