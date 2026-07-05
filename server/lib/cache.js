export async function withCache(redis, key, ttlSeconds, fetcher) {
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);

  const data = await fetcher();
  redis.set(key, JSON.stringify(data), 'EX', ttlSeconds).catch(() => {});
  return data;
}
