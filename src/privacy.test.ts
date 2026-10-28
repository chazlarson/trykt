import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { deleteUserAccount, exportUser } from "./account";
import { getDb } from "./db";
import { plays, titles, users } from "./db/schema";
import { createList, getListForOwner, setRating } from "./library";
import { getPlayForUser, listHistory, logMovie } from "./plays";

async function insertUser(username: string) {
  const id = crypto.randomUUID();
  await getDb().execute(sql`
    insert into "user" (id, name, email, email_verified, username, created_at, updated_at)
    values (${id}, ${username}, ${`${username}@example.com`}, true, ${username}, now(), now())
  `);
  return { id, email: `${username}@example.com` };
}

describe("private by default", () => {
  it("hides one account's log from another, including export and delete", async () => {
    const db = getDb();
    const ada = await insertUser("ada");
    const bea = await insertUser("bea");
    const [adaRow] = await db
      .select({ historyVisibility: users.historyVisibility })
      .from(users)
      .where(eq(users.id, ada.id));
    expect(adaRow?.historyVisibility).toBe("private");

    const [movie] = await db
      .insert(titles)
      .values({ kind: "movie", tmdbId: 550, name: "Example", year: 1999, fetchedAt: new Date() })
      .returning();
    if (!movie) throw new Error("movie");
    const watchedAt = new Date("2024-06-01T15:30:00.000Z");
    const play = await logMovie(ada.id, movie.id, watchedAt);
    await setRating(ada.id, "movie", movie.id, 8);
    const list = await createList(ada.id, "Quiet", null);

    expect(await listHistory(bea.id)).toEqual([]);
    expect(await getPlayForUser(bea.id, play.id)).toBeNull();
    expect(await getListForOwner(bea.id, list.id)).toBeNull();

    const adaHistory = await listHistory(ada.id);
    expect(adaHistory).toHaveLength(1);
    expect(adaHistory[0]?.watchedAt.toISOString()).toBe(watchedAt.toISOString());

    const exported = await exportUser(bea.id);
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain(play.id);
    expect(serialized).not.toContain(ada.email);
    expect(serialized).not.toContain(bea.email);
    expect(exported.plays).toEqual([]);
    expect(exported.ratings).toEqual([]);

    const adaExport = await exportUser(ada.id);
    expect(adaExport.plays.map((row) => row.id)).toEqual([play.id]);
    expect(adaExport.ratings.map((row) => row.score)).toEqual([8]);
    expect(adaExport.lists.map((row) => row.visibility)).toEqual(["private"]);

    await deleteUserAccount(ada.id);
    expect(await db.select().from(users).where(eq(users.id, ada.id))).toEqual([]);
    expect(await db.select().from(plays).where(eq(plays.userId, ada.id))).toEqual([]);
    const [cached] = await db.select().from(titles).where(eq(titles.id, movie.id));
    expect(cached?.name).toBe("Example");
    expect(await db.select().from(users).where(eq(users.id, bea.id))).toHaveLength(1);
  });
});
