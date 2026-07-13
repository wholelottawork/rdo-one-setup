import type { Redis } from 'ioredis';

/**
 * Read-through cache: return the cached JSON if present, otherwise run
 * `fetcher`, cache its result for `ttlSeconds`, and return it. A failed cache
 * write is swallowed — a hot Redis is a nice-to-have, never a hard dependency.
 */
export async function withCache<T>(
  redis: Redis,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  // A cache read failure (Redis down) is treated as a miss, not an error —
  // the route still serves fresh data, same as the old hand-rolled guards.
  const cached = await redis.get(key).catch(() => null);
  if (cached) return JSON.parse(cached) as T;

  const data = await fetcher();
  redis.set(key, JSON.stringify(data), 'EX', ttlSeconds).catch(() => {});
  return data;
}
