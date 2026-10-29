import { AppError } from "./errors";

export function utcInputValue(value = new Date()): string {
  return value.toISOString().slice(0, 16);
}

export function parseUtcInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function watchedAtFrom(value: FormDataEntryValue | null): Date {
  if (typeof value !== "string") throw new AppError("fields");
  const parsed = parseUtcInput(value);
  if (!parsed) throw new AppError("fields");
  if (parsed.getTime() > Date.now() + 5 * 60 * 1000) throw new AppError("future");
  return parsed;
}

export function formatStamp(value: Date): string {
  return (
    new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(value) + " UTC"
  );
}
