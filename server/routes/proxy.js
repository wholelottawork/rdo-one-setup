import { withCache } from '../lib/cache.js';
import { fetchJSON, fetchText } from '../lib/fetcher.js';

export default async function proxyRoutes(fastify) {

  // ── Hyperliquid (POST) ─────────────────────────────────────────────────────
  fastify.post('/hl/*', async (req, reply) => {
    const path     = req.params['*'];
    const body     = req.body || {};
    const ttl      = body.type === 'metaAndAssetCtxs' ? 5 : 2;
    const cacheKey = `hl:${path}:${JSON.stringify(body)}`;

    return withCache(fastify.redis, cacheKey, ttl, () =>
      fetchJSON(`https://api.hyperliquid.xyz/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
  });

  // ── Binance (GET — candlestick data, tickers) ──────────────────────────────
  fastify.get('/binance/*', async (req) => {
    const path     = req.params['*'];
    const qs       = new URLSearchParams(req.query).toString();
    const url      = `https://api.binance.com/${path}${qs ? '?' + qs : ''}`;
    const cacheKey = `binance:${url}`;

    return withCache(fastify.redis, cacheKey, 5, () => fetchJSON(url));
  });

  // ── CoinGecko (GET — market data, global stats, trending) ─────────────────
  fastify.get('/coingecko/*', async (req) => {
    const path     = req.params['*'];
    const qs       = new URLSearchParams(req.query).toString();
    const url      = `https://api.coingecko.com/${path}${qs ? '?' + qs : ''}`;
    const cacheKey = `cg:${url}`;

    return withCache(fastify.redis, cacheKey, 60, () => fetchJSON(url));
  });

  // ── Fear & Greed index (updates once per day) ──────────────────────────────
  fastify.get('/feargreed/*', async (req) => {
    const path     = req.params['*'];
    const qs       = new URLSearchParams(req.query).toString();
    const url      = `https://api.alternative.me/${path}${qs ? '?' + qs : ''}`;
    const cacheKey = `fg:${url}`;

    return withCache(fastify.redis, cacheKey, 3600, () => fetchJSON(url));
  });

  // ── Aster DEX fapi (GET + POST) ───────────────────────────────────────────
  const ASTER_HEADERS = {
    'Referer': 'https://www.asterdex.com/',
    'Origin': 'https://www.asterdex.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };

  fastify.get('/aster-fapi/*', async (req) => {
    const path     = req.params['*'];
    const qs       = new URLSearchParams(req.query).toString();
    const url      = `https://fapi.asterdex.com/${path}${qs ? '?' + qs : ''}`;
    const cacheKey = `aster:${url}`;

    return withCache(fastify.redis, cacheKey, 5, () => fetchJSON(url, { headers: ASTER_HEADERS }));
  });

  fastify.post('/aster-fapi/*', async (req) => {
    const path = req.params['*'];
    const qs   = new URLSearchParams(req.query).toString();
    const url  = `https://fapi.asterdex.com/${path}${qs ? '?' + qs : ''}`;

    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ASTER_HEADERS },
      body: JSON.stringify(req.body || {}),
    });
  });

  // ── LI.FI API ─────────────────────────────────────────────────────────────
  fastify.get('/lifi-api/*', async (req) => {
    const path     = req.params['*'];
    const qs       = new URLSearchParams(req.query).toString();
    const url      = `https://li.quest/${path}${qs ? '?' + qs : ''}`;
    const cacheKey = `lifi:${url}`;

    return withCache(fastify.redis, cacheKey, 10, () => fetchJSON(url));
  });

  // ── News RSS feeds (raw XML, 5-minute cache) ───────────────────────────────
  const NEWS_SOURCES = {
    ctnews:  'https://cointelegraph.com',
    cdnews:  'https://www.coindesk.com',
    decnews: 'https://decrypt.co',
    blknews: 'https://www.theblock.co',
    bwknews: 'https://blockworks.co',
    btcmnews:'https://bitcoinmagazine.com',
    beinnews:'https://beincrypto.com',
    btcinews:'https://bitcoinist.com',
  };

  for (const [prefix, target] of Object.entries(NEWS_SOURCES)) {
    fastify.get(`/${prefix}/*`, async (req, reply) => {
      const path     = req.params['*'];
      const url      = `${target}/${path}`;
      const cacheKey = `rss:${url}`;

      const xml = await withCache(fastify.redis, cacheKey, 300, () =>
        fetchText(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' } })
      );

      reply.header('Content-Type', 'application/rss+xml; charset=utf-8');
      return xml;
    });
  }
}
