import { signUpAction } from "@/actions";
import { Notice } from "@/components/notice";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const query = await searchParams;
  return (
    <>
      <h1>Create account</h1>
      <Notice error={query.error} notice={query.notice} />
      <form className="stack" action={signUpAction}>
        <label>
          Username
          <input name="username" autoComplete="username" required minLength={3} maxLength={20} />
        </label>
        <label>
          Email
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="new-password" required minLength={8} />
        </label>
        <button className="primary" type="submit">Create account</button>
      </form>
      <p className="meta">Username is 3–20 characters: lowercase letters, numbers, underscores.</p>
    </>
  );
}
