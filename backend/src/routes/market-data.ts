import type { FastifyInstance } from 'fastify';
import { registerCachedProxy } from '../lib/cached-proxy';

/**
 * Cached GET passthroughs for the read-only market-data upstreams. All four are
 * the same shape (path + query → cache → fetch), so they're declared through
 * registerCachedProxy. TTLs preserved from the original proxy.js.
 */
export default async function marketDataRoutes(fastify: FastifyInstance) {
  // Binance spot REST — candlesticks, tickers.
  registerCachedProxy(fastify, {
    prefix: '/binance', target: 'https://api.binance.com', ttl: 5, keyNs: 'binance',
  });

  // CoinGecko — market data, global stats, trending.
  registerCachedProxy(fastify, {
    prefix: '/coingecko', target: 'https://api.coingecko.com', ttl: 60, keyNs: 'cg',
  });

  // Fear & Greed index — updates once per day.
  registerCachedProxy(fastify, {
    prefix: '/feargreed', target: 'https://api.alternative.me', ttl: 3600, keyNs: 'fg',
  });

  // LI.FI — cross-chain routes/quotes.
  registerCachedProxy(fastify, {
    prefix: '/lifi-api', target: 'https://li.quest', ttl: 10, keyNs: 'lifi',
  });
}
