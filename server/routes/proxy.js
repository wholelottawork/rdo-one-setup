import { withCache } from "../lib/cache.js";
import { fetchJSON, fetchText } from "../lib/fetcher.js";
import { signAsterV3Request } from "../lib/aster-auth.js";

export default async function proxyRoutes(fastify) {
  // ── Hyperliquid REST API (POST) ────────────────────────────────────────────
  // /exchange is a state-changing endpoint (order placement, cancels) — never cache
  fastify.post("/hl/exchange", async (req) => {
    return fetchJSON("https://api.hyperliquid.xyz/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
  });

  // All other HL info endpoints — cacheable
  fastify.post("/hl/*", async (req) => {
    const path = req.params["*"];
    const body = req.body || {};
    const ttl =
      body.type === "metaAndAssetCtxs"
        ? 5
        : body.type === "candleSnapshot"
          ? 10
          : body.type === "clearinghouseState"
            ? 3
            : body.type === "userFills"
              ? 30
              : body.type === "userFundingHistory"
                ? 30
                : body.type === "openOrders"
                  ? 3
                  : 2;
    const cacheKey = `hl:${path}:${JSON.stringify(body)}`;

    return withCache(fastify.redis, cacheKey, ttl, () =>
      fetchJSON(`https://api.hyperliquid.xyz/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  });

  // ── Hyperliquid TESTNET REST API (POST) ────────────────────────────────────
  // Simple pass-through, no caching — testnet is low volume and needs real-time responses
  fastify.post("/hl-testnet/*", async (req) => {
    const path = req.params["*"];
    return fetchJSON(`https://api.hyperliquid-testnet.xyz/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {}),
    });
  });

  // ── Binance (GET — candlestick data, tickers) ──────────────────────────────
  fastify.get("/binance/*", async (req) => {
    const path = req.params["*"];
    const qs = new URLSearchParams(req.query).toString();
    const url = `https://api.binance.com/${path}${qs ? "?" + qs : ""}`;
    const cacheKey = `binance:${url}`;

    return withCache(fastify.redis, cacheKey, 5, () => fetchJSON(url));
  });

  // ── CoinGecko (GET — market data, global stats, trending) ─────────────────
  fastify.get("/coingecko/*", async (req) => {
    const path = req.params["*"];
    const qs = new URLSearchParams(req.query).toString();
    const url = `https://api.coingecko.com/${path}${qs ? "?" + qs : ""}`;
    const cacheKey = `cg:${url}`;

    return withCache(fastify.redis, cacheKey, 60, () => fetchJSON(url));
  });

  // ── Fear & Greed index (updates once per day) ──────────────────────────────
  fastify.get("/feargreed/*", async (req) => {
    const path = req.params["*"];
    const qs = new URLSearchParams(req.query).toString();
    const url = `https://api.alternative.me/${path}${qs ? "?" + qs : ""}`;
    const cacheKey = `fg:${url}`;

    return withCache(fastify.redis, cacheKey, 3600, () => fetchJSON(url));
  });

  // ── Aster DEX fapi (GET + POST) ───────────────────────────────────────────
  const ASTER_HEADERS = {
    Referer: "https://www.asterdex.com/",
    Origin: "https://www.asterdex.com",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  };

  fastify.get("/aster-fapi/*", async (req) => {
    const path = req.params["*"];
    const qs = new URLSearchParams(req.query).toString();
    const url = `https://fapi.asterdex.com/${path}${qs ? "?" + qs : ""}`;
    const cacheKey = `aster:${url}`;

    return withCache(fastify.redis, cacheKey, 5, () =>
      fetchJSON(url, { headers: ASTER_HEADERS }),
    );
  });

  fastify.post("/aster-fapi/*", async (req) => {
    const path = req.params["*"];
    const qs = new URLSearchParams(req.query).toString();
    const url = `https://fapi.asterdex.com/${path}${qs ? "?" + qs : ""}`;

    return fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ASTER_HEADERS },
      body: JSON.stringify(req.body || {}),
    });
  });

  // ── Aster Pro API V3 — signed endpoints (TRADE/USER_DATA/USER_STREAM) ──────
  // Never cached: each call needs a fresh, strictly-increasing nonce, and the
  // response is account-specific. See server/lib/aster-auth.js for the
  // EIP-712 signing itself.
  fastify.get("/aster-signed/*", async (req) => {
    const path = req.params["*"];
    const signedQuery = await signAsterV3Request(req.query);
    const url = `https://fapi.asterdex.com/${path}?${signedQuery}`;

    return fetchJSON(url, {
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...ASTER_HEADERS },
    });
  });

  // Leverage brackets are exchange risk config, not account-specific data —
  // unlike other signed endpoints, safe (and worth) caching. Omitting
  // `symbol` returns all ~600 symbols' brackets in one signed call instead of
  // one request per symbol, so this is also what keeps us off Aster's rate
  // limit compared to the old per-symbol Open Interest approach.
  fastify.get("/aster-leverage-brackets", async () => {
    return withCache(fastify.redis, "aster:leverage-brackets", 300, async () => {
      const signedQuery = await signAsterV3Request({});
      const url = `https://fapi.asterdex.com/fapi/v3/leverageBracket?${signedQuery}`;
      return fetchJSON(url, {
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...ASTER_HEADERS },
      });
    });
  });

  fastify.post("/aster-signed/*", async (req) => {
    const path = req.params["*"];
    const signedQuery = await signAsterV3Request(req.body || {});
    const url = `https://fapi.asterdex.com/${path}`;

    return fetchJSON(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...ASTER_HEADERS },
      body: signedQuery,
    });
  });

  // ── LI.FI API ─────────────────────────────────────────────────────────────
  fastify.get("/lifi-api/*", async (req) => {
    const path = req.params["*"];
    const qs = new URLSearchParams(req.query).toString();
    const url = `https://li.quest/${path}${qs ? "?" + qs : ""}`;
    const cacheKey = `lifi:${url}`;

    return withCache(fastify.redis, cacheKey, 10, () => fetchJSON(url));
  });

  // ── News RSS feeds (raw XML, 5-minute cache) ───────────────────────────────
  const NEWS_SOURCES = {
    ctnews: "https://cointelegraph.com",
    cdnews: "https://www.coindesk.com",
    decnews: "https://decrypt.co",
    blknews: "https://www.theblock.co",
    bwknews: "https://blockworks.co",
    btcmnews: "https://bitcoinmagazine.com",
    beinnews: "https://beincrypto.com",
    btcinews: "https://bitcoinist.com",
  };

  for (const [prefix, target] of Object.entries(NEWS_SOURCES)) {
    fastify.get(`/${prefix}/*`, async (req, reply) => {
      const path = req.params["*"];
      const url = `${target}/${path}`;
      const cacheKey = `rss:${url}`;

      const xml = await withCache(fastify.redis, cacheKey, 300, () =>
        fetchText(url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; RDO-ONE/1.0)" },
        }),
      );

      reply.header("Content-Type", "application/rss+xml; charset=utf-8");
      return xml;
    });
  }
}
