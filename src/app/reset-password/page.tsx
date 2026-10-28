import { redirect } from "next/navigation";
import { resetPasswordAction } from "@/actions";
import { Notice } from "@/components/notice";

export default async function ResetPasswordQueryPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; token?: string }>;
}) {
  const query = await searchParams;
  if (!query.token) redirect("/forgot-password");
  return (
    <>
      <h1>Choose a password</h1>
      <Notice error={query.error} notice={query.notice} />
      <form className="stack" action={resetPasswordAction}>
        <input type="hidden" name="token" value={query.token} />
        <label>
          New password
          <input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </label>
        <button className="primary" type="submit">Save password</button>
      </form>
    </>
  );
}
