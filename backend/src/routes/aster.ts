import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BaseWallet } from 'ethers';
import { withCache } from '../lib/cache';
import { fetchJSON } from '../lib/fetcher';
import { registerCachedProxy } from '../lib/cached-proxy';
import { signAsterV3Request, signAsterV3RequestAs } from '../lib/aster-auth';
import { getOrCreateUserAgent } from '../lib/agent-keystore';
import type { AsterOIBulkBody } from '../types';

const ASTER_FAPI = 'https://fapi.asterdex.com';

const ASTER_HEADERS = {
  Referer: 'https://www.asterdex.com/',
  Origin: 'https://www.asterdex.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
};

const SIGNED_HEADERS = { 'Content-Type': 'application/x-www-form-urlencoded', ...ASTER_HEADERS };

export default async function asterRoutes(fastify: FastifyInstance) {
  // ── Aster DEX fapi (GET public market data — cached) ───────────────────────
  registerCachedProxy(fastify, {
    prefix: '/aster-fapi', target: ASTER_FAPI, ttl: 5, keyNs: 'aster', headers: ASTER_HEADERS,
  });

  // ── Aster DEX fapi (POST — passthrough, never cached) ──────────────────────
  fastify.post('/aster-fapi/*', async (req: FastifyRequest) => {
    const path = (req.params as Record<string, string>)['*'];
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const url = `${ASTER_FAPI}/${path}${qs ? '?' + qs : ''}`;

    return fetchJSON(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...ASTER_HEADERS },
      body: JSON.stringify(req.body ?? {}),
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
  fastify.post('/aster-oi-bulk', async (req: FastifyRequest) => {
    const body = (req.body ?? {}) as AsterOIBulkBody;
    const symbols = Array.isArray(body.symbols) ? body.symbols : [];
    const out: Record<string, number> = {};
    for (let i = 0; i < symbols.length; i += OI_BULK_BATCH) {
      const batch = symbols.slice(i, i + OI_BULK_BATCH);
      await Promise.all(batch.map(async (sym) => {
        try {
          const cacheKey = `aster:oi:${sym}`;
          const d = await withCache<{ openInterest?: string }>(fastify.redis, cacheKey, OI_CACHE_TTL, () =>
            fetchJSON(`${ASTER_FAPI}/fapi/v1/openInterest?symbol=${sym}USDT`, { headers: ASTER_HEADERS }),
          );
          out[sym] = parseFloat(d.openInterest ?? '0');
        } catch { /* skip symbol */ }
      }));
    }
    return out;
  });

  // ── Aster Pro API V3 — signed endpoints (TRADE/USER_DATA/USER_STREAM) ──────
  // Never cached: each call needs a fresh, strictly-increasing nonce, and the
  // response is account-specific.
  //
  // Every one of these is signed with the CALLING USER's own dedicated agent
  // wallet (src/lib/agent-keystore.ts), not a shared one — Aster resolves
  // account identity from the signer alone on most of these endpoints, so a
  // single shared signer can only ever act as one user at a time (see the
  // frontend's lib/aster.ts ASTER_BUILDER_ADDRESS comment for the full
  // writeup). `user` is therefore required on every call here, not just
  // informational.
  async function requireUserAgent(
    reply: FastifyReply,
    userAddress: unknown,
  ): Promise<BaseWallet | null> {
    if (!userAddress || typeof userAddress !== 'string') {
      reply.code(400).send({ error: 'user required' });
      return null;
    }
    return getOrCreateUserAgent(fastify.redis, userAddress);
  }

  // Signed passthroughs must NOT use fetchJSON: on non-2xx it THROWS
  // (discarding Aster's real {code, msg} body — e.g. -1111 "Precision is
  // over the maximum defined for this asset") and worse, RETRIES the call
  // twice — re-firing a rejected order placement three times. Forward
  // Aster's actual body instead; the frontend branches on data.code /
  // data.msg, same contract as /aster-approve-agent below.
  async function signedPassthrough(url: string, init: RequestInit) {
    const res = await fetch(url, init);
    return res
      .json()
      .catch(() => ({ code: res.status, msg: 'Non-JSON response from Aster' }));
  }

  fastify.get('/aster-signed/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = (req.params as Record<string, string>)['*'];
    const query = req.query as Record<string, string>;
    const wallet = await requireUserAgent(reply, query.user);
    if (!wallet) return;
    const signedQuery = await signAsterV3RequestAs(wallet, query);
    const url = `${ASTER_FAPI}/${path}?${signedQuery}`;

    return signedPassthrough(url, { headers: SIGNED_HEADERS });
  });

  // Returns (creating on first call) the address of the caller's own
  // dedicated Aster agent — the frontend needs this BEFORE it can sign
  // approveAgent, since agentAddress must name that specific per-user
  // signer, not a fixed constant. Never returns the private key.
  fastify.get('/aster-agent-address', async (req: FastifyRequest, reply: FastifyReply) => {
    const wallet = await requireUserAgent(reply, (req.query as Record<string, string>).user);
    if (!wallet) return;
    return { agentAddress: wallet.address };
  });

  // Leverage brackets are exchange risk config, not account-specific data —
  // unlike other signed endpoints, safe (and worth) caching. Omitting
  // `symbol` returns all ~600 symbols' brackets in one signed call instead of
  // one request per symbol, so this is also what keeps us off Aster's rate
  // limit compared to the old per-symbol Open Interest approach.
  fastify.get('/aster-leverage-brackets', async () =>
    withCache(fastify.redis, 'aster:leverage-brackets', 300, async () => {
      const signedQuery = await signAsterV3Request({});
      const url = `${ASTER_FAPI}/fapi/v3/leverageBracket?${signedQuery}`;
      return fetchJSON(url, { headers: SIGNED_HEADERS });
    }),
  );

  fastify.post('/aster-signed/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = (req.params as Record<string, string>)['*'];
    const body = (req.body ?? {}) as Record<string, string>;
    const wallet = await requireUserAgent(reply, body.user);
    if (!wallet) return;
    const signedQuery = await signAsterV3RequestAs(wallet, body);

    return signedPassthrough(`${ASTER_FAPI}/${path}`, {
      method: 'POST',
      headers: SIGNED_HEADERS,
      body: signedQuery,
    });
  });

  // PUT/DELETE variants of the same signed passthrough — needed for the
  // listenKey user-data-stream lifecycle (PUT to keepalive, DELETE to
  // close), which are otherwise identical USER_STREAM-auth signed calls.
  fastify.put('/aster-signed/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = (req.params as Record<string, string>)['*'];
    const body = (req.body ?? {}) as Record<string, string>;
    const wallet = await requireUserAgent(reply, body.user);
    if (!wallet) return;
    const signedQuery = await signAsterV3RequestAs(wallet, body);

    return signedPassthrough(`${ASTER_FAPI}/${path}`, {
      method: 'PUT',
      headers: SIGNED_HEADERS,
      body: signedQuery,
    });
  });

  fastify.delete('/aster-signed/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = (req.params as Record<string, string>)['*'];
    const body = (req.body ?? {}) as Record<string, string>;
    const wallet = await requireUserAgent(reply, body.user);
    if (!wallet) return;
    const signedQuery = await signAsterV3RequestAs(wallet, body);

    return signedPassthrough(`${ASTER_FAPI}/${path}`, {
      method: 'DELETE',
      headers: SIGNED_HEADERS,
      body: signedQuery,
    });
  });

  // approveAgent (Aster Code builder-program endpoint) is PUBLIC
  // (unauthenticated) and signed by the END USER's own wallet client-side,
  // not by our agent — this route never touches ASTER_SIGNER_PRIVATE_KEY,
  // it's a plain form-urlencoded passthrough carrying whatever signature
  // the browser already produced. NOT registerAndApproveAgent (the older,
  // general-V3-docs endpoint this used to call) — that one doesn't honor
  // the builder/maxFeeRate/builderName fields the frontend now signs (see
  // the frontend's lib/aster.ts approveAsterAgent doc comment).
  //
  // Uses a raw fetch (not the shared fetchJSON helper) because fetchJSON
  // throws away the response body on non-2xx status, replacing it with a
  // generic "HTTP 400" — Aster always returns a real {code, msg} body even
  // on failure (e.g. "Signature check failed"), and the frontend needs that
  // actual message, not a swallowed one.
  fastify.post('/aster-approve-agent', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = new URLSearchParams((req.body ?? {}) as Record<string, string>).toString();
    const res = await fetch(`${ASTER_FAPI}/fapi/v3/approveAgent`, {
      method: 'POST',
      headers: SIGNED_HEADERS,
      body,
    });
    const data = await res.json().catch(() => ({ code: res.status, msg: 'Non-JSON response from Aster' }));
    reply.code(res.status >= 400 && res.status < 600 ? 200 : res.status); // forward Aster's own {code,msg} body either way; the frontend checks data.code, not HTTP status
    return data;
  });
}
