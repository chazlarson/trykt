import Link from "next/link";
import { notFound } from "next/navigation";
import { removeListItemAction } from "@/actions";
import { Notice } from "@/components/notice";
import { getListForOwner } from "@/library";
import { requireUser } from "@/session";

export default async function ListPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const list = await getListForOwner(session.user.id, id);
  if (!list) notFound();
  const query = await searchParams;
  return (
    <>
      <h1>{list.name}</h1>
      <p className="meta">Private{list.description ? ` · ${list.description}` : ""}</p>
      <Notice error={query.error} notice={query.notice} />
      {list.items.length === 0 ? <p>Nothing on this list.</p> : null}
      {list.items.map((item) => {
        const title = item.movie ?? item.show;
        if (!title) return null;
        const href = item.movie ? `/movies/${title.id}` : `/shows/${title.id}`;
        return (
          <article className="item spread" key={item.id}>
            <div>
              <Link href={href}>{title.name}</Link>
              <p className="meta">
                {item.movie ? "Movie" : "Show"}
                {title.year ? ` · ${title.year}` : ""}
              </p>
            </div>
            <form action={removeListItemAction}>
              <input type="hidden" name="list_id" value={list.id} />
              <input type="hidden" name="item_id" value={item.id} />
              <input type="hidden" name="return" value={`/lists/${list.id}`} />
              <button type="submit">Remove</button>
            </form>
          </article>
        );
      })}
    </>
  );
}
