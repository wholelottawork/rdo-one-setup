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
  { prefix, target, ttl, keyNs, headers }: CachedProxyOptions,
): void {
  fastify.get(`${prefix}/*`, async (req: FastifyRequest) => {
    const path = (req.params as Record<string, string>)['*'];
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const url = `${target}/${path}${qs ? '?' + qs : ''}`;
    return withCache(fastify.redis, `${keyNs}:${url}`, ttl, () =>
      fetchJSON(url, headers ? { headers } : {}),
    );
  });
}
