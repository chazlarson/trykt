import { notFound } from "next/navigation";
import { logMovieAction, removePlayAction } from "@/actions";
import { openMovie } from "@/catalog/store";
import { Notice } from "@/components/notice";
import { Poster } from "@/components/poster";
import { ListPicker, RatingForm, ShelfButton, TimeField, WatchlistButton } from "@/components/title-tools";
import { messageFor } from "@/copy";
import { listLists, shelfItemForMovie, watchlistItemForTitle, getRating } from "@/library";
import { listMoviePlays } from "@/plays";
import { requireUser } from "@/session";
import { formatStamp } from "@/time";

export default async function MoviePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const opened = await openMovie(session.user.id, id);
  if (!opened) notFound();
  const query = await searchParams;
  const path = `/movies/${id}`;
  const [rating, watch, shelf, lists, plays] = await Promise.all([
    getRating(session.user.id, "movie", id),
    watchlistItemForTitle(session.user.id, "movie", id),
    shelfItemForMovie(session.user.id, id),
    listLists(session.user.id),
    listMoviePlays(session.user.id, id),
  ]);
  const notice =
    messageFor(query.error) ?? messageFor(query.notice) ?? (opened.notice ? messageFor(opened.notice) : null);
  const movie = opened.movie;
  return (
    <>
      <div className="row">
        <Poster path={movie.posterPath} />
        <div>
          <h1>{movie.name}</h1>
          <p className="meta">
            Movie{movie.year ? ` · ${movie.year}` : ""}
            {movie.runtimeMin ? ` · ${movie.runtimeMin} min` : ""}
          </p>
          {movie.unavailableAt ? <p>TMDB no longer lists this title. The log entry stays.</p> : null}
          {movie.overview ? <p>{movie.overview}</p> : null}
        </div>
      </div>
      {notice ? <p className="notice">{notice}</p> : <Notice />}
      <form className="actions" action={logMovieAction}>
        <input type="hidden" name="movie_id" value={movie.id} />
        <input type="hidden" name="return" value={path} />
        <TimeField />
        <button className="primary" type="submit">Log watch</button>
      </form>
      <div className="stack">
        <RatingForm subjectType="movie" subjectId={movie.id} score={rating?.score ?? null} returnPath={path} />
        <div className="actions">
          <WatchlistButton titleId={movie.id} kind="movie" itemId={watch?.id ?? null} returnPath={path} />
          <ShelfButton movieId={movie.id} itemId={shelf?.id ?? null} returnPath={path} />
        </div>
        <ListPicker lists={lists} titleId={movie.id} kind="movie" returnPath={path} />
      </div>
      <h2>Plays</h2>
      {plays.length === 0 ? <p>Nothing logged yet.</p> : null}
      {plays.map((play) => (
        <article className="item spread" key={play.id}>
          <time dateTime={play.watchedAt.toISOString()}>{formatStamp(play.watchedAt)}</time>
          <form action={removePlayAction}>
            <input type="hidden" name="play_id" value={play.id} />
            <input type="hidden" name="return" value={path} />
            <button type="submit">Remove from log</button>
          </form>
        </article>
      ))}
    </>
  );
}
