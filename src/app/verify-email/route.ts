import { auth } from "@/auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) return Response.redirect(new URL("/verify", url));
  try {
    await auth.api.verifyEmail({ query: { token }, headers: request.headers });
  } catch {
    return Response.redirect(new URL("/verify?error=verify-failed", url));
  }
  return Response.redirect(new URL("/sign-in?notice=verified", url));
}
