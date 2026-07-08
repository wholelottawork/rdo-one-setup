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

  // Aster has no bulk Open Interest endpoint (confirmed against both the V1
  // and V3 docs) — only one symbol per call. With ~600 live Aster symbols,
  // having the BROWSER fire one request per symbol single-handedly blew
  // through our own rate limiter (200 req/60s per IP) on its own, well
  // before counting anything else the app does. This collapses that into
  // ONE client-facing request; we still stagger the upstream Aster calls
  // server-side in small batches, same as before — this only fixes how many
  // requests count against *our* limiter, not upstream call volume.
  const OI_BULK_BATCH = 15;
  // Aster itself rate-limits at 2400 req/min per IP — with ~600 symbols,
  // caching each one for only 5s meant a full OI refresh cycle (every 90s
  // client-side, see useAsterOpenInterest) sent ~600 fresh upstream requests
  // nearly every time, which is what actually tripped Aster's own limiter
  // (as opposed to ours, fixed earlier by batching client→server). OI
  // doesn't need sub-minute freshness, so cache well past the 90s client
  // interval — most refresh cycles now hit Redis instead of Aster at all,
  // regardless of how many users/tabs are polling concurrently.
  const OI_CACHE_TTL = 120;
  fastify.post("/aster-oi-bulk", async (req) => {
    const symbols = Array.isArray(req.body?.symbols) ? req.body.symbols : [];
    const out = {};
    for (let i = 0; i < symbols.length; i += OI_BULK_BATCH) {
      const batch = symbols.slice(i, i + OI_BULK_BATCH);
      await Promise.all(batch.map(async (sym) => {
        try {
          const cacheKey = `aster:oi:${sym}`;
          const d = await withCache(fastify.redis, cacheKey, OI_CACHE_TTL, () =>
            fetchJSON(`https://fapi.asterdex.com/fapi/v1/openInterest?symbol=${sym}USDT`, { headers: ASTER_HEADERS }),
          );
          out[sym] = parseFloat(d.openInterest ?? 0);
        } catch { /* skip symbol */ }
      }));
    }
    return out;
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

  // registerAndApproveAgent is PUBLIC (unauthenticated) and signed by the
  // END USER's own wallet client-side, not by our agent — this route never
  // touches ASTER_SIGNER_PRIVATE_KEY, it's a plain form-urlencoded
  // passthrough carrying whatever signature the browser already produced.
  //
  // Uses a raw fetch (not the shared fetchJSON helper) because fetchJSON
  // throws away the response body on non-2xx status, replacing it with a
  // generic "HTTP 400" — Aster always returns a real {code, msg} body even
  // on failure (e.g. "Signature check failed"), and the frontend needs that
  // actual message, not a swallowed one.
  fastify.post("/aster-register-agent", async (req, reply) => {
    const body = new URLSearchParams(req.body || {}).toString();
    const res = await fetch("https://fapi.asterdex.com/fapi/v3/registerAndApproveAgent", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...ASTER_HEADERS },
      body,
    });
    const data = await res.json().catch(() => ({ code: res.status, msg: "Non-JSON response from Aster" }));
    reply.code(res.status >= 400 && res.status < 600 ? 200 : res.status); // forward Aster's own {code,msg} body either way; the frontend checks data.code, not HTTP status
    return data;
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
