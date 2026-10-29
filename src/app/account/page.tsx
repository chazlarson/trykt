import { deleteAccountAction, forgotPasswordAction, signOutAction } from "@/actions";
import { Notice } from "@/components/notice";
import { requireUser, usernameOf } from "@/session";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const session = await requireUser();
  const query = await searchParams;
  return (
    <>
      <h1>Account</h1>
      <Notice error={query.error} notice={query.notice} />
      <p>{usernameOf(session.user)}</p>
      <p className="meta">{session.user.email}</p>
      <p className="actions">
        <a className="button" href="/api/export">Export JSON</a>
      </p>
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
