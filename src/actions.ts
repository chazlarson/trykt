"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { auth } from "./auth";
import { deleteUserAccount } from "./account";
import {
  addListItem,
  addMovieToShelf,
  addToWatchlist,
  clearRating,
  createList,
  removeListItem,
  removeShelfItem,
  removeWatchlistItem,
  setRating,
} from "./library";
import { clearImports } from "./import/store";
import { logMutation } from "./log";
import { clearManualEpisodePlays, logEpisode, logMovie, logSeason, removePlay } from "./plays";
import { fail, redirectTo, safePath } from "./redirects";
import { requireUser, usernameOf } from "./session";
import { watchedAtFrom } from "./time";

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/);
const emailSchema = z.email();
const passwordSchema = z.string().min(8).max(128);
const idSchema = z.uuid();

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function statusCode(error: unknown): number {
  if (!error || typeof error !== "object") return 0;
  if ("statusCode" in error && typeof error.statusCode === "number") return error.statusCode;
  if ("status" in error && typeof error.status === "number") return error.status;
  return 0;
}

export async function signUpAction(formData: FormData) {
  const username = usernameSchema.safeParse(field(formData, "username"));
  const email = emailSchema.safeParse(field(formData, "email").trim().toLowerCase());
  const password = passwordSchema.safeParse(field(formData, "password"));
  if (!username.success || !email.success || !password.success) redirectTo("/sign-up", "fields", "error");
  const headerList = await headers();
  try {
    const body = {
      name: username.data,
      username: username.data,
      email: email.data,
      password: password.data,
      callbackURL: "/sign-in",
    };
    await auth.api.signUpEmail({
      body,
      headers: headerList,
    });
  } catch (error) {
    redirectTo("/sign-up", statusCode(error) === 429 ? "rate" : "taken", "error");
  }
  redirectTo("/verify", "signed-up");
}

export async function signInAction(formData: FormData) {
  const email = emailSchema.safeParse(field(formData, "email").trim().toLowerCase());
  const password = passwordSchema.safeParse(field(formData, "password"));
  if (!email.success || !password.success) redirectTo("/sign-in", "fields", "error");
  const headerList = await headers();
  try {
    await auth.api.signInEmail({
      body: { email: email.data, password: password.data },
      headers: headerList,
    });
  } catch (error) {
    const status = statusCode(error);
    redirectTo("/sign-in", status === 429 ? "rate" : status === 403 ? "verify" : "sign-in", "error");
  }
  redirectTo("/", undefined);
}

export async function clearImportAction() {
  const session = await requireUser();
  await clearImports(session.user.id);
  logMutation("import.clear", 200, session.user.id);
  redirectTo("/account", "import-cleared");
}

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirectTo("/", undefined);
}

export async function verifyAction(formData: FormData) {
  const token = field(formData, "code").trim();
  if (!token) redirectTo("/verify", "verify-failed", "error");
  try {
    await auth.api.verifyEmail({ query: { token } });
  } catch {
    redirectTo("/verify", "verify-failed", "error");
  }
  redirectTo("/sign-in", "verified");
}

export async function forgotPasswordAction(formData: FormData) {
  const email = emailSchema.safeParse(field(formData, "email").trim().toLowerCase());
  if (!email.success) redirectTo("/forgot-password", "fields", "error");
  const headerList = await headers();
  try {
    await auth.api.requestPasswordReset({
      body: { email: email.data, redirectTo: "/reset-password" },
      headers: headerList,
    });
  } catch (error) {
    redirectTo("/forgot-password", statusCode(error) === 429 ? "rate" : "password", "error");
  }
  redirectTo("/forgot-password", "reset-sent");
}

export async function resetPasswordAction(formData: FormData) {
  const token = field(formData, "token").trim();
  const password = passwordSchema.safeParse(field(formData, "password"));
  const back = token ? `/reset-password/${encodeURIComponent(token)}` : "/forgot-password";
  if (!token || !password.success) redirectTo(back, "fields", "error");
  try {
    await auth.api.resetPassword({
      body: { token, newPassword: password.data },
      headers: await headers(),
    });
  } catch (error) {
    redirectTo(back, statusCode(error) === 429 ? "rate" : "password", "error");
  }
  redirectTo("/sign-in", "password-set");
}

export async function logMovieAction(formData: FormData) {
  const session = await requireUser();
  const movieId = idSchema.safeParse(field(formData, "movie_id"));
  const path = safePath(formData.get("return"), movieId.success ? `/movies/${movieId.data}` : "/");
  if (!movieId.success) fail(path, null);
  try {
    const watchedAt = watchedAtFrom(formData.get("watched_at"));
    await logMovie(session.user.id, movieId.data, watchedAt);
    logMutation("plays.log_movie", 200, session.user.id);
  } catch (error) {
    logMutation("plays.log_movie", 400, session.user.id);
    fail(path, error);
  }
  redirectTo(path, undefined);
}

export async function logEpisodeAction(formData: FormData) {
  const session = await requireUser();
  const episodeId = idSchema.safeParse(field(formData, "episode_id"));
  const path = safePath(formData.get("return"), "/");
  if (!episodeId.success) fail(path, null);
  try {
    await logEpisode(session.user.id, episodeId.data, watchedAtFrom(formData.get("watched_at")));
    logMutation("plays.log_episode", 200, session.user.id);
  } catch (error) {
    logMutation("plays.log_episode", 400, session.user.id);
    fail(path, error);
  }
  redirectTo(path, undefined);
}

export async function logSeasonAction(formData: FormData) {
  const session = await requireUser();
  const seasonId = idSchema.safeParse(field(formData, "season_id"));
  const path = safePath(formData.get("return"), "/");
  if (!seasonId.success) fail(path, null);
  try {
    await logSeason(session.user.id, seasonId.data, watchedAtFrom(formData.get("watched_at")));
    logMutation("plays.log_season", 200, session.user.id);
  } catch (error) {
    logMutation("plays.log_season", 400, session.user.id);
    fail(path, error);
  }
  redirectTo(path, "season");
}

export async function clearEpisodeAction(formData: FormData) {
  const session = await requireUser();
  const episodeId = idSchema.safeParse(field(formData, "episode_id"));
  const path = safePath(formData.get("return"), "/");
  if (!episodeId.success) fail(path, null);
  try {
    await clearManualEpisodePlays(session.user.id, episodeId.data);
    logMutation("plays.clear_episode", 200, session.user.id);
  } catch (error) {
    logMutation("plays.clear_episode", 400, session.user.id);
    fail(path, error);
  }
  redirectTo(path, "cleared");
}

export async function removePlayAction(formData: FormData) {
  const session = await requireUser();
  const playId = idSchema.safeParse(field(formData, "play_id"));
  const path = safePath(formData.get("return"), "/history");
  if (!playId.success) fail(path, null);
  try {
    const removed = await removePlay(session.user.id, playId.data);
    logMutation("plays.remove", removed ? 200 : 404, session.user.id);
    if (!removed) fail(path, null);
  } catch (error) {
    logMutation("plays.remove", 400, session.user.id);
    fail(path, error);
  }
  redirectTo(path, "removed");
}

export async function watchlistAction(formData: FormData) {
  const session = await requireUser();
  const titleId = idSchema.safeParse(field(formData, "title_id"));
  const kind = field(formData, "kind") === "show" ? "show" : "movie";
  const path = safePath(formData.get("return"), "/watchlist");
  const removeId = field(formData, "item_id");
  try {
    if (removeId) {
      const parsed = idSchema.safeParse(removeId);
      if (!parsed.success) fail(path, null);
      await removeWatchlistItem(session.user.id, parsed.data);
    } else {
      if (!titleId.success) fail(path, null);
      await addToWatchlist(session.user.id, kind, titleId.data);
    }
  } catch (error) {
    fail(path, error);
  }
  redirectTo(path, undefined);
}

export async function shelfAction(formData: FormData) {
  const session = await requireUser();
  const path = safePath(formData.get("return"), "/shelf");
  const removeId = field(formData, "item_id");
  try {
    if (removeId) {
      const parsed = idSchema.safeParse(removeId);
      if (!parsed.success) fail(path, null);
      await removeShelfItem(session.user.id, parsed.data);
    } else {
      const movieId = idSchema.safeParse(field(formData, "movie_id"));
      if (!movieId.success) fail(path, null);
      await addMovieToShelf(session.user.id, movieId.data);
    }
  } catch (error) {
    fail(path, error);
  }
  redirectTo(path, undefined);
}

export async function ratingAction(formData: FormData) {
  const session = await requireUser();
  const path = safePath(formData.get("return"), "/");
  const subjectType = z.enum(["movie", "show", "season", "episode"]).safeParse(field(formData, "subject_type"));
  const subjectId = idSchema.safeParse(field(formData, "subject_id"));
  if (!subjectType.success || !subjectId.success) fail(path, null);
  try {
    if (formData.get("clear") === "1") {
      await clearRating(session.user.id, subjectType.data, subjectId.data);
    } else {
      const score = z.coerce.number().int().min(1).max(10).safeParse(field(formData, "score"));
      if (!score.success) fail(path, null);
      await setRating(session.user.id, subjectType.data, subjectId.data, score.data);
    }
    logMutation("ratings.save", 200, session.user.id);
  } catch (error) {
    logMutation("ratings.save", 400, session.user.id);
    fail(path, error);
  }
  redirectTo(path, undefined);
}

export async function createListAction(formData: FormData) {
  const session = await requireUser();
  const name = z.string().trim().min(1).max(80).safeParse(field(formData, "name"));
  const description = z.string().trim().max(500).safeParse(field(formData, "description"));
  if (!name.success || !description.success) redirectTo("/lists", "fields", "error");
  try {
    const list = await createList(session.user.id, name.data, description.data.length ? description.data : null);
    redirectTo(`/lists/${list.id}`, undefined);
  } catch (error) {
    fail("/lists", error);
  }
}

export async function addListItemAction(formData: FormData) {
  const session = await requireUser();
  const listId = idSchema.safeParse(field(formData, "list_id"));
  const titleId = idSchema.safeParse(field(formData, "title_id"));
  const kind = field(formData, "kind") === "show" ? "show" : "movie";
  const path = safePath(formData.get("return"), listId.success ? `/lists/${listId.data}` : "/lists");
  if (!listId.success || !titleId.success) fail(path, null);
  try {
    await addListItem(session.user.id, listId.data, kind, titleId.data);
  } catch (error) {
    fail(path, error);
  }
  redirectTo(path, undefined);
}

export async function removeListItemAction(formData: FormData) {
  const session = await requireUser();
  const listId = idSchema.safeParse(field(formData, "list_id"));
  const itemId = idSchema.safeParse(field(formData, "item_id"));
  const path = safePath(formData.get("return"), listId.success ? `/lists/${listId.data}` : "/lists");
  if (!listId.success || !itemId.success) fail(path, null);
  try {
    await removeListItem(session.user.id, listId.data, itemId.data);
  } catch (error) {
    fail(path, error);
  }
  redirectTo(path, undefined);
}

export async function deleteAccountAction(formData: FormData) {
  const session = await requireUser();
  if (field(formData, "confirm").trim().toLowerCase() !== usernameOf(session.user).toLowerCase()) {
    redirectTo("/account", "confirmed", "error");
  }
  const userId = session.user.id;
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // The account delete still removes the session row.
  }
  await deleteUserAccount(userId);
  redirectTo("/", undefined);
}
