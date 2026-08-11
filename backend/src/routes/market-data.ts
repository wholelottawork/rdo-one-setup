import type { FastifyInstance } from 'fastify';
import { registerCachedProxy } from '../lib/cached-proxy';
import { config } from '../config';

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

  // LI.FI — cross-chain routes/quotes. Unauthenticated, li.quest allows only 75
  // /quote calls per two hours *per IP*, and every user of this backend shares
  // the VPS's one IP. A free Partner Portal key lifts that to 100/min (~24x) and
  // is sent as the custom `x-lifi-api-key` header. Running without a key stays a
  // supported configuration (dev machines have none), so when it is unset we
  // send no header at all rather than an empty one, which upstream may reject.
  //
  // ponytail: this cache barely helps /quote. registerCachedProxy keys on the
  // full URL, and a quote URL carries fromAmount plus both addresses, so each
  // keystroke in the Transfer amount field is a fresh key and a guaranteed miss.
  // It is left alone on purpose: a quote's transactionRequest.data encodes the
  // exact amount and the fromAddress/toAddress it was built for, so neither
  // bucketing the amount nor dropping the addresses from the key is safe — the
  // first would sign a transaction for the wrong amount, the second would hand
  // one wallet another wallet's calldata. The API key alone covers the volume.
  //
  // `integrator` is forced on server-side rather than passed by the Transfer
  // page. It is the Portal integration string that owns the API key, so it is
  // what LI.FI attributes the traffic (and, if fee receivers are ever wired up,
  // the fees) to. Letting the browser supply it would mean any caller could
  // bill quotes to a different integration, and a caller that simply forgot it
  // would silently lose the attribution. registerCachedProxy overwrites the
  // caller's value, so neither is possible.
  registerCachedProxy(fastify, {
    prefix: '/lifi-api', target: 'https://li.quest', ttl: 10, keyNs: 'lifi',
    ...(config.lifiApiKey ? { headers: { 'x-lifi-api-key': config.lifiApiKey } } : {}),
    ...(config.lifiIntegrator ? { query: { integrator: config.lifiIntegrator } } : {}),
  });
}
