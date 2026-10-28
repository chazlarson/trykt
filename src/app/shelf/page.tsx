import Link from "next/link";
import { shelfAction } from "@/actions";
import { Notice } from "@/components/notice";
import { listShelf } from "@/library";
import { requireUser } from "@/session";

export default async function ShelfPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const query = await searchParams;
  const rows = await listShelf(session.user.id);
  return (
    <>
      <h1>Shelf</h1>
      <Notice error={query.error} notice={query.notice} />
      <p className="meta">Movies you own.</p>
      {rows.length === 0 ? <p>Nothing on the shelf.</p> : null}
      {rows.map((row) =>
        row.movie ? (
          <article className="item spread" key={row.id}>
            <div>
              <Link href={`/movies/${row.movie.id}`}>{row.movie.name}</Link>
              <p className="meta">{row.movie.year ?? "Movie"}</p>
            </div>
            <form action={shelfAction}>
              <input type="hidden" name="item_id" value={row.id} />
              <input type="hidden" name="return" value="/shelf" />
              <button type="submit">Remove</button>
            </form>
          </article>
        ) : null,
      )}
    </>
  );
}
