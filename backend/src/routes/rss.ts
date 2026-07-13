import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withCache } from '../lib/cache';
import { fetchText } from '../lib/fetcher';

// ── News RSS feeds (raw XML, 5-minute cache) ─────────────────────────────────
const NEWS_SOURCES: Record<string, string> = {
  ctnews: 'https://cointelegraph.com',
  cdnews: 'https://www.coindesk.com',
  decnews: 'https://decrypt.co',
  blknews: 'https://www.theblock.co',
  bwknews: 'https://blockworks.co',
  btcmnews: 'https://bitcoinmagazine.com',
  beinnews: 'https://beincrypto.com',
  btcinews: 'https://bitcoinist.com',
};

// Some CDNs (e.g. CoinDesk's Sanity asset host, which responds with
// `Vary: Origin` and no CORS grant) get silently rejected by Chrome's Opaque
// Response Blocking when hotlinked from an <img> tag cross-origin — the image
// fetches fine server-side (confirmed directly), it's purely a browser-side
// block. Proxying through our own origin sidesteps it, same fix as the RSS
// feeds above.
const PRIVATE_HOST_RE = /^(localhost|127\.|0\.0\.0\.0|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|169\.254\.|\[?::1\]?$|f[cd][0-9a-f]{0,2}:)/i;

export default async function rssRoutes(fastify: FastifyInstance) {
  for (const [prefix, target] of Object.entries(NEWS_SOURCES)) {
    fastify.get(`/${prefix}/*`, async (req: FastifyRequest, reply: FastifyReply) => {
      const path = (req.params as Record<string, string>)['*'];
      const url = `${target}/${path}`;
      const cacheKey = `rss:${url}`;

      const xml = await withCache(fastify.redis, cacheKey, 300, () =>
        fetchText(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
        }),
      );

      reply.header('Content-Type', 'application/rss+xml; charset=utf-8');
      return xml;
    });
  }

  // ── News article image proxy ───────────────────────────────────────────────
  fastify.get('/img-proxy', async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = (req.query as Record<string, string>).url;
    if (!raw) return reply.code(400).send({ error: 'url required' });

    let target: URL;
    try {
      target = new URL(raw);
    } catch {
      return reply.code(400).send({ error: 'invalid url' });
    }
    if (!/^https?:$/.test(target.protocol)) {
      return reply.code(400).send({ error: 'unsupported scheme' });
    }
    if (PRIVATE_HOST_RE.test(target.hostname)) {
      return reply.code(400).send({ error: 'host not allowed' });
    }

    try {
      const upstream = await fetch(target.href, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RDO-ONE/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      const contentType = upstream.headers.get('content-type') || '';
      if (!upstream.ok || !contentType.startsWith('image/')) {
        return reply.code(502).send({ error: 'upstream did not return an image' });
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      reply.header('Content-Type', contentType);
      reply.header('Cache-Control', 'public, max-age=86400');
      return reply.send(buf);
    } catch {
      return reply.code(502).send({ error: 'proxy fetch failed' });
    }
  });
}
