import { verifyAction } from "@/actions";
import { Notice } from "@/components/notice";

export default async function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const query = await searchParams;
  return (
    <>
      <h1>Verify email</h1>
      <Notice error={query.error} notice={query.notice} />
      <p>The verification code is printed in the terminal where trykt is running.</p>
      <form className="stack" action={verifyAction}>
        <label>
          Code
          <textarea name="code" required />
        </label>
        <button className="primary" type="submit">Verify</button>
      </form>
    </>
  );
}
