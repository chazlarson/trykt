import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "./db";
import { listItems, lists, titles } from "./db/schema";
import { AppError } from "./errors";
import { addListItem, createList, deleteList, getListForOwner, listLists } from "./library";

async function insertUser(username: string) {
  const id = crypto.randomUUID();
  await getDb().execute(sql`
    insert into "user" (id, name, email, email_verified, username, created_at, updated_at)
    values (${id}, ${username}, ${`${username}@example.com`}, true, ${username}, now(), now())
  `);
  return { id };
}

describe("deleteList", () => {
  it("removes that user's list and its items", async () => {
    const ada = await insertUser("ada_lists");
    const db = getDb();
    const [movie] = await db
      .insert(titles)
      .values({ kind: "movie", tmdbId: 550, name: "Example", year: 1999, fetchedAt: new Date() })
      .returning();
    const [show] = await db
      .insert(titles)
      .values({ kind: "show", tmdbId: 1396, name: "Example Show", year: 2008, fetchedAt: new Date() })
      .returning();
    if (!movie || !show) throw new Error("title");
    const list = await createList(ada.id, "Quiet", "Sunday");
    const kept = await createList(ada.id, "Keep", null);
    await addListItem(ada.id, list.id, "movie", movie.id);
    await addListItem(ada.id, kept.id, "show", show.id);

    await deleteList(ada.id, list.id);

    expect(await getListForOwner(ada.id, list.id)).toBeNull();
    expect(await db.select().from(lists).where(eq(lists.id, list.id))).toEqual([]);
    expect(await db.select().from(listItems).where(eq(listItems.listId, list.id))).toEqual([]);
    const remaining = await listLists(ada.id);
    expect(remaining.map((row) => row.id)).toEqual([kept.id]);
    const keptItems = await db.select().from(listItems).where(eq(listItems.listId, kept.id));
    expect(keptItems).toHaveLength(1);
    expect(await db.select().from(titles).where(eq(titles.id, movie.id))).toHaveLength(1);
  });

  it("leaves another user's list and items in place", async () => {
    const ada = await insertUser("ada_keep");
    const bea = await insertUser("bea_keep");
    const db = getDb();
    const [movie] = await db
      .insert(titles)
      .values({ kind: "movie", tmdbId: 680, name: "Other", year: 1994, fetchedAt: new Date() })
      .returning();
    if (!movie) throw new Error("movie");
    const list = await createList(ada.id, "Quiet", null);
    await addListItem(ada.id, list.id, "movie", movie.id);

    await expect(deleteList(bea.id, list.id)).rejects.toMatchObject({ name: "AppError", code: "list-missing" });

    const kept = await getListForOwner(ada.id, list.id);
    expect(kept?.name).toBe("Quiet");
    expect(kept?.items).toHaveLength(1);
    expect(await db.select().from(listItems).where(eq(listItems.listId, list.id))).toHaveLength(1);
  });
});
