import { headers } from "next/headers";
import { exportUser } from "@/account";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return new Response("Sign in to export.", { status: 401 });
  const body = await exportUser(session.user.id);
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": 'attachment; filename="trykt-export.json"',
    },
  });
}
