import { deleteAccountAction, forgotPasswordAction, signOutAction } from "@/actions";
import { Notice } from "@/components/notice";
import type { ImportErrorReport } from "@/db/schema";
import { latestImport } from "@/import/store";
import { requireUser, usernameOf } from "@/session";

function counted(count: number, one: string, many: string): string {
  if (count === 0) return "";
  return `${count} ${count === 1 ? one : many}`;
}

function countLine(report: ImportErrorReport): string {
  const parts = [
    counted(report.counts.plays, "play", "plays"),
    counted(report.counts.ratings, "rating", "ratings"),
    counted(report.counts.watchlist, "on the watchlist", "on the watchlist"),
    counted(report.counts.lists, "list", "lists"),
    counted(report.counts.list_items, "list item", "list items"),
    counted(report.counts.shelf, "on the shelf", "on the shelf"),
  ].filter(Boolean);
  return parts.length > 0 ? `Added ${parts.join(", ")}.` : "Nothing new was added.";
}

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const query = await searchParams;
  const job = await latestImport(session.user.id);
  const report = job?.errorReport ?? null;
  const busy = job?.status === "queued" || job?.status === "running";
  return (
    <>
      {busy ? <meta httpEquiv="refresh" content="2" /> : null}
      <h1>Account</h1>
      <Notice error={query.error} notice={query.notice} />
      <p>{usernameOf(session.user)}</p>
      <p className="meta">{session.user.email}</p>
      <p className="actions">
        <a className="button" href="/api/export">Export JSON</a>
      </p>
      <h2>Import</h2>
      <p>Upload a ZIP of your own log export. Movies and shows match on TMDB or IMDb ids. The file is deleted when the import finishes.</p>
      {busy ? (
        <p>{job?.status === "running" ? "Import is running." : "Import is queued."}</p>
      ) : (
        <form className="stack" action="/api/import" method="post" encType="multipart/form-data">
          <label>
            ZIP file
            <input name="file" type="file" accept=".zip,application/zip" required />
          </label>
          <button className="primary" type="submit">Import</button>
        </form>
      )}
      {job && report ? (
        <section>
          {job.status === "failed" && report.failure ? <p>{report.failure}</p> : null}
          {job.status === "finished" ? <p>{countLine(report)}</p> : null}
          {report.counts.notes_skipped > 0 ? <p>Written notes in the file were not imported.</p> : null}
          {report.files.map((file) => (
            <p key={file.name}>{file.name}: {file.reason}</p>
          ))}
          {report.unmatched.length > 0 ? (
            <>
              <p>{report.unmatched.length} unmatched.</p>
              <ul>
                {report.unmatched.slice(0, 8).map((row, index) => (
                  <li key={`${row.title}-${row.year ?? "x"}-${index}`}>
                    {row.title}
                    {row.year ? ` (${row.year})` : ""} — {row.reason}
                  </li>
                ))}
              </ul>
              <p>
                <a href={`/api/import/${job.id}`}>Download unmatched rows</a>
              </p>
            </>
          ) : null}
        </section>
      ) : null}
      <form action={signOutAction}>
        <button type="submit">Sign out</button>
      </form>
      <h2>Password</h2>
      <form action={forgotPasswordAction}>
        <input type="hidden" name="email" value={session.user.email} />
        <button type="submit">Send a reset code</button>
      </form>
      <h2>Delete account</h2>
      <p>This removes your log, ratings, lists, watchlist, and shelf. The title cache stays.</p>
      <form className="stack" action={deleteAccountAction}>
        <label>
          Type {usernameOf(session.user)} to delete the account
          <input name="confirm" autoComplete="off" />
        </label>
        <button type="submit">Delete account</button>
      </form>
    </>
  );
}
