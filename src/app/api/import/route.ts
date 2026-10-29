import { isRedirectError } from "next/dist/client/components/redirect-error";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppError } from "@/errors";
import { enqueueImport } from "@/import/queue";
import { acceptImport, deleteImportFiles, markFailed } from "@/import/store";
import { logMutation } from "@/log";
import { redirectTo } from "@/redirects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const expected = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(expected).origin;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  if (!sameOrigin(request)) redirectTo("/account", "import-failed", "error");
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    redirectTo("/account", "import-type", "error");
  }
  const file = form.get("file");
  if (!(file instanceof File)) redirectTo("/account", "import-type", "error");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let jobId: string;
  try {
    jobId = await acceptImport(session.user.id, bytes);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    redirectTo("/account", error instanceof AppError ? error.code : "import-failed", "error");
  }
  try {
    await enqueueImport(jobId);
  } catch (error) {
    if (isRedirectError(error)) throw error;
    await markFailed(jobId, "Import failed. Try the file again.");
    await deleteImportFiles([jobId]);
    redirectTo("/account", "import-failed", "error");
  }
  logMutation("import.enqueue", 202, session.user.id);
  redirectTo("/account", "import-queued");
}
