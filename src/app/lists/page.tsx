import Link from "next/link";
import { createListAction } from "@/actions";
import { Notice } from "@/components/notice";
import { listLists } from "@/library";
import { requireUser } from "@/session";

export default async function ListsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const query = await searchParams;
  const rows = await listLists(session.user.id);
  return (
    <>
      <h1>Lists</h1>
      <Notice error={query.error} notice={query.notice} />
      <p className="meta">Private.</p>
      <form className="stack" action={createListAction}>
        <label>
          Name
          <input name="name" required maxLength={80} />
        </label>
        <label>
          Description
          <textarea name="description" maxLength={500} />
        </label>
        <button className="primary" type="submit">Create list</button>
      </form>
      {rows.length === 0 ? <p>No lists yet.</p> : null}
      {rows.map((list) => (
        <article className="item" key={list.id}>
          <Link href={`/lists/${list.id}`}>{list.name}</Link>
          <p className="meta">Private{list.description ? ` · ${list.description}` : ""}</p>
        </article>
      ))}
    </>
  );
}
