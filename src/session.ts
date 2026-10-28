import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

export function usernameOf(user: { name: string }): string {
  const username = (user as { username?: string }).username;
  return username && username.length > 0 ? username : user.name;
}
