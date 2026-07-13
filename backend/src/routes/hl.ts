import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withCache } from '../lib/cache';
import { fetchJSON } from '../lib/fetcher';

const HL_API = 'https://api.hyperliquid.xyz';
const HL_TESTNET_API = 'https://api.hyperliquid-testnet.xyz';

// Per-request-type cache TTL (seconds) for the HL /info endpoints. Trade-facing
// data (fills, orders, positions) stays short; static-ish meta a bit longer.
function ttlFor(type: unknown): number {
  switch (type) {
    case 'metaAndAssetCtxs': return 5;
    case 'candleSnapshot': return 10;
    case 'clearinghouseState': return 3;
    case 'userFills': return 30;
    case 'userFundingHistory': return 30;
    case 'openOrders': return 3;
    default: return 2;
  }
}

interface HLBody {
  type?: string;
  [key: string]: unknown;
}

export default async function hlRoutes(fastify: FastifyInstance) {
  // /exchange is state-changing (order placement, cancels) — never cache.
  fastify.post('/hl/exchange', async (req: FastifyRequest) =>
    fetchJSON(`${HL_API}/exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    }),
  );

  // All other HL info endpoints — cacheable per request type.
  fastify.post('/hl/*', async (req: FastifyRequest) => {
    const path = (req.params as Record<string, string>)['*'];
    const body = (req.body ?? {}) as HLBody;
    const cacheKey = `hl:${path}:${JSON.stringify(body)}`;

    return withCache(fastify.redis, cacheKey, ttlFor(body.type), () =>
      fetchJSON(`${HL_API}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  });

  // Testnet — simple pass-through, no caching (low volume, wants real-time).
  fastify.post('/hl-testnet/*', async (req: FastifyRequest) => {
    const path = (req.params as Record<string, string>)['*'];
    return fetchJSON(`${HL_TESTNET_API}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body ?? {}),
    });
  });
}
