import Link from "next/link";
import { createListAction, deleteListAction } from "@/actions";
import { Notice } from "@/components/notice";
import { listLists } from "@/library";
import { requireUser } from "@/session";

export default async function ListsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; confirm?: string }>;
}) {
  const session = await requireUser();
  const query = await searchParams;
  const rows = await listLists(session.user.id);
  const confirming = rows.some((list) => list.id === query.confirm) ? query.confirm : undefined;
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
      {rows.map((list) => {
        const pending = confirming === list.id;
        return (
          <article className="item" key={list.id}>
            <div className="spread">
              <div>
                <Link href={`/lists/${list.id}`}>{list.name}</Link>
                <p className="meta">Private{list.description ? ` · ${list.description}` : ""}</p>
              </div>
              {pending ? null : (
                <form action={deleteListAction}>
                  <input type="hidden" name="list_id" value={list.id} />
                  <button type="submit">
                    Delete<span className="sr"> {list.name}</span>
                  </button>
                </form>
              )}
            </div>
            {pending ? (
              <form action={deleteListAction}>
                <input type="hidden" name="list_id" value={list.id} />
                <input type="hidden" name="confirm" value="yes" />
                <p>Delete this list and its items?</p>
                <div className="actions">
                  <button type="submit">
                    Delete<span className="sr"> {list.name}</span>
                  </button>
                  <a className="button" href="/lists">Cancel</a>
                </div>
              </form>
            ) : null}
          </article>
        );
      })}
    </>
  );
}
