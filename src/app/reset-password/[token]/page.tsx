import { resetPasswordAction } from "@/actions";
import { Notice } from "@/components/notice";

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string; notice?: string; token?: string }>;
}) {
  const { token: pathToken } = await params;
  const query = await searchParams;
  const token = query.token || decodeURIComponent(pathToken);
  return (
    <>
      <h1>Choose a password</h1>
      <Notice error={query.error} notice={query.notice} />
      <form className="stack" action={resetPasswordAction}>
        <input type="hidden" name="token" value={token} />
        <label>
          New password
          <input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </label>
        <button className="primary" type="submit">Save password</button>
      </form>
    </>
  );
}
