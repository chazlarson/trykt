import Link from "next/link";
import { shelfAction } from "@/actions";
import { Notice } from "@/components/notice";
import { episodeLabel } from "@/copy";
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
      <p className="meta">Movies and episodes you own.</p>
      {rows.length === 0 ? <p>Nothing on the shelf.</p> : null}
      {rows.map((row) => {
        const movie = row.movie;
        const episode = row.episode;
        if (!movie && !episode) return null;
        return (
          <article className="item spread" key={row.id}>
            <div>
              {movie ? <Link href={`/movies/${movie.id}`}>{movie.name}</Link> : null}
              {episode ? (
                <Link href={`/shows/${episode.showId}`}>
                  {episode.showName} · {episodeLabel(episode.seasonNumber, episode.episodeNumber)} · {episode.name}
                </Link>
              ) : null}
              <p className="meta">{movie ? (movie.year ?? "Movie") : "Episode"}</p>
            </div>
            <form action={shelfAction}>
              <input type="hidden" name="item_id" value={row.id} />
              <input type="hidden" name="return" value="/shelf" />
              <button type="submit">Remove</button>
            </form>
          </article>
        );
      })}
    </>
  );
}
