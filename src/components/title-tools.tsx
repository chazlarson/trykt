import { ratingAction, shelfAction, watchlistAction, addListItemAction } from "@/actions";
import { utcInputValue } from "@/time";

export function RatingForm({
  subjectType,
  subjectId,
  score,
  returnPath,
}: {
  subjectType: "movie" | "show" | "season" | "episode";
  subjectId: string;
  score: number | null;
  returnPath: string;
}) {
  return (
    <form className="actions" action={ratingAction}>
      <input type="hidden" name="subject_type" value={subjectType} />
      <input type="hidden" name="subject_id" value={subjectId} />
      <input type="hidden" name="return" value={returnPath} />
      <label>
        Rating
        <select name="score" defaultValue={score ?? 8}>
          {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <button className="primary" type="submit">Save rating</button>
      {score ? <span className="score">{score}</span> : null}
      {score ? (
        <button type="submit" name="clear" value="1">
          Clear
        </button>
      ) : null}
    </form>
  );
}

export function WatchlistButton({
  titleId,
  kind,
  itemId,
  returnPath,
}: {
  titleId: string;
  kind: "movie" | "show";
  itemId: string | null;
  returnPath: string;
}) {
  return (
    <form action={watchlistAction}>
      <input type="hidden" name="return" value={returnPath} />
      {itemId ? <input type="hidden" name="item_id" value={itemId} /> : null}
      <input type="hidden" name="title_id" value={titleId} />
      <input type="hidden" name="kind" value={kind} />
      <button type="submit">{itemId ? "Remove from watchlist" : "Add to watchlist"}</button>
    </form>
  );
}

export function ShelfButton({
  movieId,
  itemId,
  returnPath,
}: {
  movieId: string;
  itemId: string | null;
  returnPath: string;
}) {
  return (
    <form action={shelfAction}>
      <input type="hidden" name="return" value={returnPath} />
      <input type="hidden" name="movie_id" value={movieId} />
      {itemId ? <input type="hidden" name="item_id" value={itemId} /> : null}
      <button type="submit">{itemId ? "Remove from shelf" : "Mark owned"}</button>
    </form>
  );
}

export function ListPicker({
  lists,
  titleId,
  kind,
  returnPath,
}: {
  lists: { id: string; name: string }[];
  titleId: string;
  kind: "movie" | "show";
  returnPath: string;
}) {
  if (lists.length === 0) return <a href="/lists">Create a list</a>;
  return (
    <form className="actions" action={addListItemAction}>
      <input type="hidden" name="title_id" value={titleId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="return" value={returnPath} />
      <label>
        List
        <select name="list_id">
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Add to list</button>
    </form>
  );
}

export function TimeField() {
  return (
    <label>
      Time (UTC)
      <input type="datetime-local" name="watched_at" defaultValue={utcInputValue()} required />
    </label>
  );
}
