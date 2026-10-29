import Link from "next/link";
import { searchCatalog } from "@/catalog/store";
import { Notice } from "@/components/notice";
import { Poster } from "@/components/poster";
import { messageFor } from "@/copy";
import { requireUser } from "@/session";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const query = await searchParams;
  const q = query.q?.trim() ?? "";
  const outcome = q ? await searchCatalog(session.user.id, q) : { results: [], notice: null };
  const notice = messageFor(query.error) ?? messageFor(query.notice) ?? (outcome.notice ? messageFor(outcome.notice) : null);
  return (
    <>
      <h1>Search</h1>
      {notice ? <p className="notice">{notice}</p> : <Notice />}
      {!q ? <p>Type a title to search.</p> : null}
      {q && outcome.results.length === 0 && !notice ? <p>No titles matched.</p> : null}
      <div>
        {outcome.results.map((title) => (
          <article className="item row" key={title.id}>
            <Poster path={title.posterPath} small />
            <div>
              <Link href={title.kind === "movie" ? `/movies/${title.id}` : `/shows/${title.id}`}>{title.name}</Link>
              <p className="meta">
                {title.kind === "movie" ? "Movie" : "Show"}
                {title.year ? ` · ${title.year}` : ""}
              </p>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
