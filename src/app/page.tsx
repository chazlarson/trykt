import Link from "next/link";
import { Notice } from "@/components/notice";
import { episodeLabel } from "@/copy";
import { listHistory } from "@/plays";
import { getSession } from "@/session";
import { formatStamp } from "@/time";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const query = await searchParams;
  const session = await getSession();
  return (
    <>
      <h1>Log</h1>
      <Notice error={query.error} notice={query.notice} />
      {session ? (
        <>
          <p>Search for a movie or a show, then log the watch.</p>
          <Recent userId={session.user.id} />
        </>
      ) : (
        <>
          <p>A private log of movies and shows.</p>
          <p className="actions">
            <Link className="button primary" href="/sign-in">Sign in</Link>
            <Link className="button" href="/sign-up">Create account</Link>
          </p>
        </>
      )}
    </>
  );
}

async function Recent({ userId }: { userId: string }) {
  const rows = await listHistory(userId, 5);
  if (rows.length === 0) return <p>Nothing logged yet.</p>;
  return (
    <>
      <h2>Recent</h2>
      <div>
        {rows.map((row) => (
          <article className="item" key={row.id}>
            <div className="spread">
              <div>
                {row.movie ? (
                  <Link href={`/movies/${row.movie.id}`}>{row.movie.name}</Link>
                ) : row.episode ? (
                  <Link href={`/shows/${row.episode.showId}`}>
                    {row.episode.showName} · {episodeLabel(row.episode.seasonNumber, row.episode.episodeNumber)}
                  </Link>
                ) : (
                  "Play"
                )}
              </div>
              <time className="meta" dateTime={row.watchedAt.toISOString()}>
                {formatStamp(row.watchedAt)}
              </time>
            </div>
          </article>
        ))}
      </div>
      <p><Link href="/history">History</Link></p>
    </>
  );
}
