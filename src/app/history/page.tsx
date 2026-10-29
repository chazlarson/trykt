import Link from "next/link";
import { removePlayAction } from "@/actions";
import { Notice } from "@/components/notice";
import { episodeLabel } from "@/copy";
import { listHistory } from "@/plays";
import { requireUser } from "@/session";
import { formatStamp } from "@/time";

function sourceLabel(source: string) {
  if (source === "manual") return "logged";
  if (source === "bulk") return "season";
  if (source === "playback") return "playback";
  if (source === "import") return "imported";
  return "logged";
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const query = await searchParams;
  const rows = await listHistory(session.user.id);
  return (
    <>
      <h1>History</h1>
      <Notice error={query.error} notice={query.notice} />
      {rows.length === 0 ? <p>Nothing logged yet.</p> : null}
      {rows.map((row) => (
        <article className="item" key={row.id}>
          <div className="spread">
            <div>
              {row.movie ? (
                <Link href={`/movies/${row.movie.id}`}>{row.movie.name}</Link>
              ) : row.episode ? (
                <Link href={`/shows/${row.episode.showId}`}>
                  {row.episode.showName} · {episodeLabel(row.episode.seasonNumber, row.episode.episodeNumber)} ·{" "}
                  {row.episode.name}
                </Link>
              ) : (
                "Play"
              )}
              <p className="meta">{sourceLabel(row.source)}</p>
            </div>
            <time dateTime={row.watchedAt.toISOString()}>{formatStamp(row.watchedAt)}</time>
          </div>
          <form action={removePlayAction}>
            <input type="hidden" name="play_id" value={row.id} />
            <input type="hidden" name="return" value="/history" />
            <button type="submit">Remove from log</button>
          </form>
        </article>
      ))}
    </>
  );
}
