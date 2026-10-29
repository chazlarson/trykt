import { headers } from "next/headers";
import { auth } from "@/auth";
import { importForOwner } from "@/import/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Sign in to download the report.", { status: 401 });
  const { jobId } = await context.params;
  const job = await importForOwner(session.user.id, jobId);
  if (!job?.errorReport) return new Response("That report is not ready.", { status: 404 });
  return new Response(JSON.stringify({ unmatched: job.errorReport.unmatched }, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="unmatched.json"',
    },
  });
}
