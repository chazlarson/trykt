import Link from "next/link";
import { signInAction } from "@/actions";
import { Notice } from "@/components/notice";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const query = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      <Notice error={query.error} notice={query.notice} />
      <form className="stack" action={signInAction}>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        <button className="primary" type="submit">Sign in</button>
      </form>
      <p><Link href="/forgot-password">Forgot password</Link></p>
      <p><Link href="/verify">Enter a verification code</Link></p>
    </>
  );
}
