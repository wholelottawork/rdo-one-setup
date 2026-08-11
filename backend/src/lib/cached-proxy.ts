import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withCache } from './cache';
import { fetchJSON } from './fetcher';

export interface CachedProxyOptions {
  /** Route prefix without the trailing wildcard, e.g. "/binance". */
  prefix: string;
  /** Upstream origin the wildcard path is appended to, e.g. "https://api.binance.com". */
  target: string;
  /** Cache TTL in seconds. */
  ttl: number;
  /** Redis key namespace, e.g. "binance". */
  keyNs: string;
  /** Optional upstream request headers (e.g. Aster's Referer/Origin/UA). */
  headers?: Record<string, string>;
  /**
   * Optional query parameters forced onto every forwarded request. These
   * OVERWRITE any same-named param the caller sent, which is the point: it is
   * how a server-side identity (LI.FI's `integrator`) gets attached without
   * trusting the browser to send it, or letting the browser send someone
   * else's. Values land in the cache key too, but they are constant per
   * process, so they cost nothing in hit rate.
   */
  query?: Record<string, string>;
}

/**
 * Registers a cached GET proxy of the shape used all over this backend:
 * take the wildcard path + query string, forward to `${target}/${path}?${qs}`,
 * and serve it through the shared read-through cache. Collapses what were five
 * copy-pasted handlers (binance, coingecko, feargreed, lifi, aster-fapi) into
 * one declarative call each. Reuses withCache + fetchJSON — no new fetch logic.
 */
export function registerCachedProxy(
  fastify: FastifyInstance,
  { prefix, target, ttl, keyNs, headers, query }: CachedProxyOptions,
): void {
  fastify.get(`${prefix}/*`, async (req: FastifyRequest) => {
    const path = (req.params as Record<string, string>)['*'];
    const params = new URLSearchParams(req.query as Record<string, string>);
    for (const [k, v] of Object.entries(query ?? {})) params.set(k, v);
    const qs = params.toString();
    const url = `${target}/${path}${qs ? '?' + qs : ''}`;
    return withCache(fastify.redis, `${keyNs}:${url}`, ttl, () =>
      fetchJSON(url, headers ? { headers } : {}),
    );
  });
}
