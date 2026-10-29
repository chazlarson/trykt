import { notFound } from "next/navigation";
import { clearEpisodeAction, logEpisodeAction, logSeasonAction } from "@/actions";
import { openShow } from "@/catalog/store";
import { Notice } from "@/components/notice";
import { Poster } from "@/components/poster";
import { ListPicker, RatingForm, TimeField, WatchlistButton } from "@/components/title-tools";
import { episodeLabel, messageFor } from "@/copy";
import { getRating, listLists, watchlistItemForTitle } from "@/library";
import { episodePlayCounts, latestEpisodePlay, nextEpisode } from "@/plays";
import { requireUser } from "@/session";

export default async function ShowPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const opened = await openShow(session.user.id, id);
  if (!opened) notFound();
  const query = await searchParams;
  const path = `/shows/${id}`;
  const userId = session.user.id;
  const [rating, watch, lists, next, leftOff, counts] = await Promise.all([
    getRating(userId, "show", id),
    watchlistItemForTitle(userId, "show", id),
    listLists(userId),
    nextEpisode(userId, id),
    latestEpisodePlay(userId, id),
    episodePlayCounts(userId, id),
  ]);
  const notice =
    messageFor(query.error) ?? messageFor(query.notice) ?? (opened.notice ? messageFor(opened.notice) : null);
  const show = opened.show;
  const anyPlay = [...counts.values()].some((count) => count.manual + count.locked > 0);
  return (
    <>
      <div className="row">
        <Poster path={show.posterPath} />
        <div>
          <h1>{show.name}</h1>
          <p className="meta">
            Show{show.year ? ` · ${show.year}` : ""}
            {show.status ? ` · ${show.status}` : ""}
          </p>
          <p className="meta">Episode order follows TMDB.</p>
          {show.unavailableAt ? <p>TMDB no longer lists this title. The log entry stays.</p> : null}
          {show.overview ? <p>{show.overview}</p> : null}
        </div>
      </div>
      {notice ? <p className="notice">{notice}</p> : <Notice />}
      {!anyPlay ? <p>Nothing logged yet.</p> : null}
      {leftOff ? <p>Left off at {episodeLabel(leftOff.seasonNumber, leftOff.episodeNumber)}</p> : null}
      {next ? (
        <p>
          Next is {episodeLabel(next.seasonNumber, next.episodeNumber)} · {next.name}
        </p>
      ) : anyPlay ? (
        <p>No aired episode left.</p>
      ) : null}
      <div className="stack">
        <RatingForm subjectType="show" subjectId={show.id} score={rating?.score ?? null} returnPath={path} />
        <WatchlistButton titleId={show.id} kind="show" itemId={watch?.id ?? null} returnPath={path} />
        <ListPicker lists={lists} titleId={show.id} kind="show" returnPath={path} />
      </div>
      {opened.seasons.map((season) => (
        <section key={season.id}>
          <h2>{season.name}</h2>
          {season.seasonNumber === 0 ? (
            <p className="meta">Specials are not the next episode. Log one at a time.</p>
          ) : (
            <form className="actions" action={logSeasonAction}>
              <input type="hidden" name="season_id" value={season.id} />
              <input type="hidden" name="return" value={path} />
              <TimeField />
              <button className="primary" type="submit">Mark season watched</button>
            </form>
          )}
          {season.episodes.map((episode) => {
            const count = counts.get(episode.id) ?? { manual: 0, locked: 0 };
            return (
              <article className="episode" key={episode.id}>
                <div className="spread">
                  <strong>
                    {episodeLabel(season.seasonNumber, episode.episodeNumber)} · {episode.name}
                  </strong>
                  <span className="meta">{episode.airDate ?? "No air date"}</span>
                </div>
                {count.manual + count.locked > 0 ? (
                  <p className="meta">
                    Logged{count.locked > 0 ? " · remove playback from history" : ""}
                  </p>
                ) : null}
                <form className="actions" action={logEpisodeAction}>
                  <input type="hidden" name="episode_id" value={episode.id} />
                  <input type="hidden" name="return" value={path} />
                  <TimeField />
                  <button className="primary" type="submit">Log watch</button>
                </form>
                {count.manual > 0 ? (
                  <form action={clearEpisodeAction}>
                    <input type="hidden" name="episode_id" value={episode.id} />
                    <input type="hidden" name="return" value={path} />
                    <button type="submit">Clear manual logs</button>
                  </form>
                ) : null}
              </article>
            );
          })}
        </section>
      ))}
    </>
  );
}
