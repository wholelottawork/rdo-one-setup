import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { BaseWallet } from 'ethers';
import { withCache } from '../lib/cache';
import { fetchJSON } from '../lib/fetcher';
import { registerCachedProxy } from '../lib/cached-proxy';
import { signAsterV3Request, signAsterV3RequestAs } from '../lib/aster-auth';
import { getOrCreateUserAgent } from '../lib/agent-keystore';
import { addTpslWatch, startTpslWatcher } from '../lib/aster-tpsl-watcher';
import { verifyWalletAuth } from '../lib/wallet-auth';
import { endSession, peekSession, requireSession, startSession } from '../lib/aster-session';
import { asterWithdrawParams, toPlainDecimal, verifyAsterWithdrawAuthorization } from '../lib/aster-withdraw';
import { moneyLog, moneyWarn } from '../lib/money-log';
import { config } from '../config';
import type { AsterOIBulkBody } from '../types';

const ASTER_FAPI = 'https://fapi.asterdex.com';
// Withdrawal fee quotes live on a different host from everything else.
const ASTER_SAPI = 'https://sapi.asterdex.com';

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
  // writeup).
  //
  // WHICH user is therefore the entire access-control decision, and it comes
  // from the session cookie (src/lib/aster-session.ts) — never from a `user`
  // param, which is a public address anyone could type. The param is
  // overwritten with the session's address before signing so a stale or
  // hostile one can't reach Aster either.
  async function sessionAgent(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ user: string; wallet: BaseWallet } | null> {
    const user = await requireSession(fastify, req, reply);
    if (!user) return null;
    return { user, wallet: await getOrCreateUserAgent(fastify.redis, user) };
  }

  // ── Trading session ───────────────────────────────────────────────────────
  // One wallet signature opens it; the cookie carries it from there. See
  // lib/aster-session.ts for why this surface gets a session while the
  // fund-moving V1 routes below keep per-request signatures.
  fastify.post('/aster-session', async (req: FastifyRequest, reply: FastifyReply) => {
    const { user, timestamp, signature } = (req.body ?? {}) as Record<string, string>;
    const owner = await authed(reply, 'aster-session', user, {}, timestamp, signature);
    if (!owner) return;
    const expiresIn = await startSession(fastify.redis, reply, owner);
    if (expiresIn === null) return; // 503 already sent — no cookie was set
    return { user: owner, expiresIn };
  });

  // "Do I already have one?" — no signature, no prompt, and it can only ever
  // report the caller's own cookie back to them.
  fastify.get('/aster-session', async (req: FastifyRequest) => {
    // `unavailable` distinguishes "you are not logged in" from "we can't tell"
    // so the frontend doesn't drop a live session on a Redis blip. Additive:
    // callers that only read `user` are unaffected.
    if (!fastify.redisOk) return { user: null, unavailable: true };
    try {
      return { user: await peekSession(fastify.redis, req) };
    } catch {
      return { user: null, unavailable: true };
    }
  });

  fastify.delete('/aster-session', async (req: FastifyRequest, reply: FastifyReply) => {
    await endSession(fastify.redis, req, reply, fastify.redisOk);
    return { ended: true };
  });

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
    const auth = await sessionAgent(req, reply);
    if (!auth) return;
    const query = { ...(req.query as Record<string, string>), user: auth.user };
    const signedQuery = await signAsterV3RequestAs(auth.wallet, query);
    const url = `${ASTER_FAPI}/${path}?${signedQuery}`;

    return signedPassthrough(url, { headers: SIGNED_HEADERS });
  });

  // Returns (creating on first call) the address of the caller's own
  // dedicated Aster agent — the frontend needs this BEFORE it can sign
  // approveAgent, since agentAddress must name that specific per-user
  // signer, not a fixed constant. Never returns the private key.
  fastify.get('/aster-agent-address', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await sessionAgent(req, reply);
    if (!auth) return;
    return { agentAddress: auth.wallet.address };
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
    const auth = await sessionAgent(req, reply);
    if (!auth) return;
    const body = { ...((req.body ?? {}) as Record<string, string>), user: auth.user };
    const signedQuery = await signAsterV3RequestAs(auth.wallet, body);

    const data = await signedPassthrough(`${ASTER_FAPI}/${path}`, {
      method: 'POST',
      headers: SIGNED_HEADERS,
      body: signedQuery,
    });

    // Order placement is a money path and, until now, one that left no trace:
    // production logs at `warn`, this route returns 200 whatever Aster says,
    // and a rejected order was indistinguishable from a placed one after the
    // fact. `signedQuery` is deliberately NOT logged — it carries the agent
    // signature. The body fields below are the user's own order parameters.
    logOrderOutcome(path, auth.user, body, data);

    return data;
  });

  // Aster answers a rejected order with HTTP 200 and a negative `code`, so the
  // status tells you nothing — the body is the only outcome there is.
  function logOrderOutcome(
    path: string,
    user: string,
    body: Record<string, string>,
    data: unknown,
  ) {
    if (!/\border\b/i.test(path)) return; // only the order endpoints are money
    const r = (data ?? {}) as { code?: number; msg?: string; orderId?: number | string; status?: string };
    const line = {
      user,
      path,
      symbol: body.symbol,
      side: body.side,
      type: body.type,
      quantity: body.quantity,
      price: body.price,
      stopPrice: body.stopPrice,
      reduceOnly: body.reduceOnly,
      closePosition: body.closePosition,
    };
    if (typeof r.code === 'number' && r.code < 0) {
      moneyWarn(fastify, 'order.rejected', { ...line, code: r.code, msg: r.msg });
    } else {
      moneyLog(fastify, 'order.placed', {
        ...line,
        orderId: r.orderId != null ? String(r.orderId) : null,
        status: r.status ?? null,
      });
    }
  }

  // PUT/DELETE variants of the same signed passthrough — needed for the
  // listenKey user-data-stream lifecycle (PUT to keepalive, DELETE to
  // close), which are otherwise identical USER_STREAM-auth signed calls.
  fastify.put('/aster-signed/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = (req.params as Record<string, string>)['*'];
    const auth = await sessionAgent(req, reply);
    if (!auth) return;
    const body = { ...((req.body ?? {}) as Record<string, string>), user: auth.user };
    const signedQuery = await signAsterV3RequestAs(auth.wallet, body);

    return signedPassthrough(`${ASTER_FAPI}/${path}`, {
      method: 'PUT',
      headers: SIGNED_HEADERS,
      body: signedQuery,
    });
  });

  fastify.delete('/aster-signed/*', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = (req.params as Record<string, string>)['*'];
    const auth = await sessionAgent(req, reply);
    if (!auth) return;
    const body = { ...((req.body ?? {}) as Record<string, string>), user: auth.user };
    const signedQuery = await signAsterV3RequestAs(auth.wallet, body);

    return signedPassthrough(`${ASTER_FAPI}/${path}`, {
      method: 'DELETE',
      headers: SIGNED_HEADERS,
      body: signedQuery,
    });
  });

  // ── TP/SL fill watcher ────────────────────────────────────────────────────
  // The browser can't be trusted to hold this wait: closing the tab used to
  // drop a resting limit's TP/SL entirely. See lib/aster-tpsl-watcher.
  fastify.post('/aster-tpsl-watch', async (req: FastifyRequest, reply: FastifyReply) => {
    const { symbol, orderId, side, tpPrice, slPrice } = (req.body ?? {}) as Record<string, string>;
    if (!symbol || !orderId || !side)
      return reply.code(400).send({ msg: 'symbol, orderId and side required' });
    if (!tpPrice && !slPrice) return reply.code(400).send({ msg: 'tpPrice or slPrice required' });
    if (!fastify.redisOk)
      return reply.code(503).send({ msg: 'Watcher unavailable (Redis down) — the browser must hold this wait' });
    // The watcher places live orders with this user's agent key later, with no
    // request in flight to re-check — so whose watch it is has to be settled
    // here, from the session, not from the body.
    const user = await requireSession(fastify, req, reply);
    if (!user) return;

    await addTpslWatch(fastify, {
      user,
      symbol,
      orderId: String(orderId),
      side: side === 'BUY' ? 'BUY' : 'SELL',
      tpPrice: tpPrice || undefined,
      slPrice: slPrice || undefined,
      createdAt: Date.now(),
    });
    return { watching: true };
  });

  startTpslWatcher(fastify);

  // ── Withdrawal (Aster V3) ─────────────────────────────────────────────────
  // This used to POST /fapi/v1/withdraw with X-MBX-APIKEY + HMAC. That
  // endpoint does not exist in Aster's API — not in V1, not in V3 — and the
  // V1 credentials it wanted cannot be issued any more (Aster stopped on
  // 2026-03-25). It had never been run against a live account, which is why
  // nobody noticed. The V3 replacement below was confirmed live; see
  // docs/aster-withdrawal-findings.md for the recipe and the evidence.
  //
  // THE SERVER HOLDS NO WITHDRAWAL CAPABILITY. Both signatures are made by
  // the user's own wallet in the browser (frontend/lib/asterWithdraw.ts) and
  // this route only verifies and forwards them. The per-user agent keys in
  // lib/agent-keystore.ts are minted with canWithdraw:false and Aster rejects
  // them here at the permission check, so there is no key on this machine
  // that could move funds out of anyone's Aster account.

  // The `fee` is a SIGNED field, so it has to be known before the wallet
  // prompt — the user is authorizing it. This quote is public (no signer, no
  // agent, unlike /fapi/v3/aster/user-withdraw-info which hard-requires
  // `signer`) and it is the same number Aster verifies against: confirmed by
  // the live withdrawal in docs/aster-withdrawal-findings.md, where BNB-on-BSC quoted
  // gasCost 1.7E-4 and the accepted signature carried fee "0.00017".
  //
  // Which is the catch worth spelling out: Aster returns small fees in
  // EXPONENT notation, and a signature over "1.7e-4" does not match one over
  // "0.00017". The fee leaves here already normalized to the exact string the
  // browser must sign, so no caller has to remember that.
  //
  // Uncached and fail-closed on purpose: a stale fee is a rejected signature,
  // and a missing one must stop the withdrawal rather than let anything
  // downstream guess.
  fastify.get('/aster-withdraw-fee', async (req: FastifyRequest, reply: FastifyReply) => {
    const { chainId, asset } = req.query as Record<string, string>;
    if (!/^\d+$/.test(chainId ?? '')) return reply.code(400).send({ msg: 'chainId required' });
    if (!/^[A-Z0-9]{1,20}$/.test(asset ?? '')) return reply.code(400).send({ msg: 'asset required' });

    let data: Record<string, unknown>;
    try {
      const res = await fetch(
        `${ASTER_SAPI}/api/v3/aster/withdraw/estimateFee?chainId=${chainId}&asset=${asset}`,
        { headers: ASTER_HEADERS, signal: AbortSignal.timeout(8000) },
      );
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      return reply.code(502).send({ msg: 'Could not reach Aster for a withdrawal fee quote' });
    }
    const gasCost = data.gasCost;
    if (typeof gasCost !== 'number' || !Number.isFinite(gasCost) || gasCost < 0)
      return reply.code(502).send({
        msg: typeof data.msg === 'string' ? data.msg : 'Aster returned no withdrawal fee',
      });

    return {
      fee: toPlainDecimal(gasCost),
      usdValue: typeof data.gasUsdValue === 'number' ? data.gasUsdValue : null,
      chainId,
      asset,
    };
  });

  // TWO independent checks, and the withdrawal needs both:
  //
  //   the session cookie decides WHOSE agent key signs the V3 auth wrapper —
  //   a `user` in the body would be a public address anyone could type; and
  //
  //   the user's own Action signature, recovered here, decides WHETHER this
  //   withdrawal was authorized at all, and for exactly which destination,
  //   amount and fee.
  //
  // The second is what keeps the agent key from being a hot wallet: Aster
  // rejects an agent-signed Action outright (measured — see
  // docs/aster-withdrawal-findings.md), so a stolen session or a
  // compromised keystore still cannot originate a withdrawal. It could only
  // replay one the user already signed, which the userNonce bounds.
  fastify.post('/aster-withdraw', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await sessionAgent(req, reply);
    if (!auth) return;

    const check = verifyAsterWithdrawAuthorization(req.body, auth.user);
    if (!check.ok) {
      moneyWarn(fastify, 'withdraw.rejected', { user: auth.user, status: check.status, reason: check.msg });
      return reply.code(check.status).send({ msg: check.msg });
    }

    // THE REQUEST BODY IS NEVER LOGGED. It carries two signatures that
    // together ARE a withdrawal, and Aster accepts a replay of the pair until
    // the nonce ages out — a log file holding them is a log file that can
    // move someone's funds.
    //
    // What IS logged is the verified, non-secret substance of it: who, how
    // much, of what, to where. Those are the fields that answer "did the 3am
    // withdrawal go through?" without holding anything replayable. They come
    // from `check.fields`, i.e. from signatures this process already recovered
    // and matched — not from whatever the body claimed.
    const { user, asset, amount, fee, chainId, receiver } = check.fields;
    const start = Date.now();
    moneyLog(fastify, 'withdraw.forwarded', { user, asset, amount, fee, chainId, receiver });

    // The wrapper signature is made HERE, with this user's own agent key —
    // the step the browser can no longer perform. signAsterV3RequestAs appends
    // `signer`, `nonce` and `signature`, so the string signed is by
    // construction the string sent.
    const signedQuery = await signAsterV3RequestAs(auth.wallet, asterWithdrawParams(check.fields));

    const data = await signedPassthrough(`${ASTER_FAPI}/fapi/v3/aster/user-withdraw`, {
      method: 'POST',
      headers: SIGNED_HEADERS,
      body: signedQuery,
    });

    const r = (data ?? {}) as { code?: number; msg?: string };
    const accepted = !(typeof r.code === 'number' && r.code < 0);
    const outcome = { user, asset, amount, chainId, receiver, code: r.code ?? null, msg: r.msg ?? null, tookMs: Date.now() - start };
    if (accepted) moneyLog(fastify, 'withdraw.result', outcome);
    else moneyWarn(fastify, 'withdraw.result', outcome);

    return data;
  });

  // `user` is a PUBLIC address, so it is never taken on trust: this helper is
  // the only thing that turns one into an authenticated owner. The caller's
  // wallet signs the action name and its parameters (lib/wallet-auth.ts) and
  // the address comes back out of that signature, never off the request body.
  async function authed(
    reply: FastifyReply,
    action: string,
    user: unknown,
    params: Record<string, string>,
    timestamp: unknown,
    signature: unknown,
  ) {
    return verifyWalletAuth({
      redis: fastify.redis, redisOk: fastify.redisOk, reply,
      action, user, params, timestamp, signature,
    });
  }

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
  // What the browser must bake into the agent approval it asks the user to
  // sign. Served rather than hardcoded in the frontend because the IP is
  // deployment state, and because `canWithdraw` has to be false when we have
  // no IP to name — Aster rejects the approval outright otherwise, which would
  // block trading for a config gap that only affects withdrawals.
  fastify.get('/aster-agent-params', async () => ({
    ipWhitelist: config.asterAgentIpWhitelist,
    canWithdraw: Boolean(config.asterAgentIpWhitelist),
  }));

  // What can ACTUALLY leave the account, which is not `availableBalance` and
  // not the same on every chain — a live account read 12.07 USDT available
  // with only 1.09 withdrawable, and USDT withdrawable on Arbitrum but not on
  // BSC while BNB was the reverse. Offering the account balance as MAX just
  // earns "You've exceeded the withdrawal limit for this chain", which reads
  // like a permissions failure and is not one.
  //
  // Aster hard-requires `signer` here, which is why this endpoint went unused
  // until per-user agent keys existed.
  fastify.get('/aster-withdraw-info', async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = await sessionAgent(req, reply);
    if (!auth) return;
    const { chainId, asset } = req.query as Record<string, string>;
    if (!/^\d+$/.test(chainId ?? '')) return reply.code(400).send({ msg: 'chainId required' });
    if (!/^[A-Z0-9]{1,20}$/.test(asset ?? '')) return reply.code(400).send({ msg: 'asset required' });

    const signedQuery = await signAsterV3RequestAs(auth.wallet, { user: auth.user, chainId, asset });
    const data = (await signedPassthrough(
      `${ASTER_FAPI}/fapi/v3/aster/user-withdraw-info?${signedQuery}`,
      { headers: SIGNED_HEADERS },
    )) as Record<string, unknown>;

    // Flattened to the one number the UI needs, so no caller has to know the
    // balances[ASSET].chainBalances[CHAIN] shape or which of the three limits
    // in there actually binds.
    const balances = (data?.balances ?? {}) as Record<string, Record<string, unknown>>;
    const entry = balances[asset];
    const perChain = ((entry?.chainBalances ?? {}) as Record<string, Record<string, unknown>>)[chainId];
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const perpMax = num(perChain?.perpMaxWithdrawAmount);
    const chainLimit = num(perChain?.chainLimit);
    const withdrawable =
      perpMax === null ? null : chainLimit === null ? perpMax : Math.min(perpMax, chainLimit);

    return {
      withdrawable,
      perpMaxWithdrawAmount: perpMax,
      chainLimit,
      withdrawFee: num(perChain?.withdrawFee),
      chainId,
      asset,
      // Absent entirely when Aster errored; the frontend distinguishes "zero
      // withdrawable" from "could not read" on this.
      ok: perChain !== undefined,
      msg: typeof data?.msg === 'string' ? data.msg : null,
    };
  });

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
