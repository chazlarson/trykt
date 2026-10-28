export const SEARCH_TTL_MS = 60 * 60 * 1000;
export const DETAIL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const EPISODE_PRODUCTION_TTL_MS = 24 * 60 * 60 * 1000;
export const EPISODE_ENDED_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_CACHE_MS = 180 * 24 * 60 * 60 * 1000;

const IN_PRODUCTION = new Set(["Returning Series", "In Production"]);

export function isInProduction(status: string | null): boolean {
  return status !== null && IN_PRODUCTION.has(status);
}

export function episodeTtlMs(status: string | null): number {
  return isInProduction(status) ? EPISODE_PRODUCTION_TTL_MS : EPISODE_ENDED_TTL_MS;
}

export function isFresh(fetchedAt: Date | null, ttlMs: number, now = Date.now()): boolean {
  if (!fetchedAt) return false;
  const age = now - fetchedAt.getTime();
  if (age < 0 || age >= MAX_CACHE_MS) return false;
  return age < ttlMs;
}

export function withinMaxCache(fetchedAt: Date | null, now = Date.now()): boolean {
  if (!fetchedAt) return false;
  const age = now - fetchedAt.getTime();
  return age >= 0 && age < MAX_CACHE_MS;
}
