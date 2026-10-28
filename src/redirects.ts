import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { AppError } from "./errors";

export function safePath(value: FormDataEntryValue | null, fallback: string): string {
  if (typeof value !== "string") return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.includes("\n")) {
    return fallback;
  }
  return value;
}

export function redirectTo(path: string, code?: string, key: "error" | "notice" = "notice"): never {
  if (!code) redirect(path);
  const [pathname, existing] = path.split("?");
  const params = new URLSearchParams(existing ?? "");
  params.delete("error");
  params.delete("notice");
  params.set(key, code);
  redirect(`${pathname}?${params.toString()}`);
}

export function fail(path: string, error: unknown): never {
  if (isRedirectError(error)) throw error;
  const code = error instanceof AppError ? error.code : "fields";
  redirectTo(path, code, "error");
}
