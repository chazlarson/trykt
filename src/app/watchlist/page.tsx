import Link from "next/link";
import { watchlistAction } from "@/actions";
import { Notice } from "@/components/notice";
import { listWatchlist } from "@/library";
import { requireUser } from "@/session";

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const query = await searchParams;
  const rows = await listWatchlist(session.user.id);
  return (
    <>
      <h1>Watchlist</h1>
      <Notice error={query.error} notice={query.notice} />
      {rows.length === 0 ? <p>Nothing waiting.</p> : null}
      {rows.map((row) => {
        const title = row.movie ?? row.show;
        if (!title) return null;
        const href = row.movie ? `/movies/${title.id}` : `/shows/${title.id}`;
        return (
          <article className="item spread" key={row.id}>
            <div>
              <Link href={href}>{title.name}</Link>
              <p className="meta">
                {row.movie ? "Movie" : "Show"}
                {title.year ? ` · ${title.year}` : ""}
              </p>
            </div>
            <form action={watchlistAction}>
              <input type="hidden" name="item_id" value={row.id} />
              <input type="hidden" name="return" value="/watchlist" />
              <button type="submit">Remove</button>
            </form>
          </article>
        );
      })}
    </>
  );
}
