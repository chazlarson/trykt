import { forgotPasswordAction } from "@/actions";
import { Notice } from "@/components/notice";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const query = await searchParams;
  return (
    <>
      <h1>Reset password</h1>
      <Notice error={query.error} notice={query.notice} />
      <p>The reset code is printed in the terminal. It works for one hour.</p>
      <form className="stack" action={forgotPasswordAction}>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <button className="primary" type="submit">Send reset</button>
      </form>
    </>
  );
}
