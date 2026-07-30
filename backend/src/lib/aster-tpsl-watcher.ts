import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { signAsterV3RequestAs } from './aster-auth';
import { getOrCreateUserAgent } from './agent-keystore';

// TP/SL for a RESTING limit order can't be placed up front: a trigger with no
// position behind it fires against nothing and is consumed, leaving the fill
// that arrives later unprotected. The browser used to hold that wait itself,
// which meant closing the tab silently dropped the protection. This moves the
// wait server-side, where a reload can't kill it.
//
// The tick is guarded by a Redis lock, so running more than one backend
// instance no longer means both place the same TP/SL.
// ponytail: still a per-instance interval racing for one lock, not a real job
// queue. Fine at this scale; if the number of instances ever gets large enough
// that most ticks are wasted lock attempts, move it to a queue.
const ASTER_FAPI = 'https://fapi.asterdex.com';
const WATCH_KEY = 'aster:tpsl-watch';
const LOCK_KEY = 'aster:tpsl-lock';
const TICK_MS = 5_000;
// Comfortably longer than a pass over every pending watch. If a pass somehow
// overruns this, the lock frees and another instance may start a second pass —
// the TTL is what bounds the damage, so keep it well above the real worst case.
const LOCK_MS = 30_000;
// Matches the browser watcher this replaces. A limit still resting after this
// long is a stale intention, not a pending fill.
const MAX_AGE_MS = 30 * 60_000;

const SIGNED_HEADERS = {
  'Content-Type': 'application/x-www-form-urlencoded',
  Referer: 'https://www.asterdex.com/',
  Origin: 'https://www.asterdex.com',
};

export interface TpslWatch {
  user: string;
  symbol: string;        // full Aster symbol, e.g. BTCUSDT
  orderId: string;
  /** Side of the CLOSING orders — opposite the entry. */
  side: 'BUY' | 'SELL';
  /** Already rounded to the symbol's tick by the caller. */
  tpPrice?: string;
  slPrice?: string;
  createdAt: number;
}

export function watchField(user: string, orderId: string) {
  return `${user.toLowerCase()}:${orderId}`;
}

async function asterCall(
  fastify: FastifyInstance,
  user: string,
  path: string,
  params: Record<string, string>,
  method: 'GET' | 'POST',
) {
  const wallet = await getOrCreateUserAgent(fastify.redis, user);
  const signed = await signAsterV3RequestAs(wallet, params);
  const url = method === 'GET' ? `${ASTER_FAPI}${path}?${signed}` : `${ASTER_FAPI}${path}`;
  const res = await fetch(url, {
    method,
    headers: SIGNED_HEADERS,
    ...(method === 'POST' ? { body: signed } : {}),
  });
  return res.json().catch(() => ({}));
}

async function placeTriggers(fastify: FastifyInstance, w: TpslWatch) {
  const legs: Promise<unknown>[] = [];
  const leg = (type: string, stopPrice: string) =>
    asterCall(fastify, w.user, '/fapi/v3/order', {
      symbol: w.symbol,
      side: w.side,
      type,
      stopPrice,
      workingType: 'MARK_PRICE',
      // Closes whatever is actually open when it fires, so a partial fill
      // can't leave an oversized trigger behind.
      closePosition: 'true',
    }, 'POST');
  if (w.tpPrice) legs.push(leg('TAKE_PROFIT_MARKET', w.tpPrice));
  if (w.slPrice) legs.push(leg('STOP_MARKET', w.slPrice));
  await Promise.all(legs);
}

/** One pass over every pending watch. Exported for the manual-trigger route
 *  and so a test can drive it without waiting on the interval. */
export async function tickTpslWatches(fastify: FastifyInstance): Promise<void> {
  if (!fastify.redisOk) return;
  // One pass at a time across the whole deployment. Without this, two
  // instances both see the same unfilled watch, both place triggers, and the
  // position ends up with a duplicate TP and SL — the second of each is
  // `closePosition` against an already-closed position, so it's consumed for
  // nothing, but it burns rate limit and leaves phantom rows in Open Orders.
  const token = randomUUID();
  if (await fastify.redis.set(LOCK_KEY, token, 'PX', LOCK_MS, 'NX') === null) return;
  try {
    await runTpslPass(fastify);
  } finally {
    // Release only if it's still ours — a pass that overran LOCK_MS must not
    // free the lock another instance has since taken.
    if (await fastify.redis.get(LOCK_KEY) === token) await fastify.redis.del(LOCK_KEY);
  }
}

async function runTpslPass(fastify: FastifyInstance): Promise<void> {
  const all = await fastify.redis.hgetall(WATCH_KEY);
  for (const [field, raw] of Object.entries(all ?? {})) {
    let w: TpslWatch;
    try {
      w = JSON.parse(raw) as TpslWatch;
    } catch {
      await fastify.redis.hdel(WATCH_KEY, field);
      continue;
    }
    if (Date.now() - w.createdAt > MAX_AGE_MS) {
      await fastify.redis.hdel(WATCH_KEY, field);
      fastify.log.info({ field }, 'aster tpsl watch expired unfilled');
      continue;
    }
    try {
      const o = (await asterCall(fastify, w.user, '/fapi/v3/order', {
        symbol: w.symbol,
        orderId: w.orderId,
      }, 'GET')) as { executedQty?: string; status?: string };

      // Any execution at all — partial counts, that's a real position.
      if (parseFloat(o?.executedQty ?? '0') > 0) {
        await placeTriggers(fastify, w);
        await fastify.redis.hdel(WATCH_KEY, field);
        fastify.log.info({ field }, 'aster tpsl placed after fill');
      } else if (['CANCELED', 'EXPIRED', 'REJECTED'].includes(String(o?.status))) {
        await fastify.redis.hdel(WATCH_KEY, field);
      }
    } catch (err) {
      // Transient upstream failure — leave the watch in place and retry next
      // tick rather than dropping a position's protection on one bad response.
      fastify.log.warn({ err, field }, 'aster tpsl watch tick failed');
    }
  }
}

export async function addTpslWatch(fastify: FastifyInstance, w: TpslWatch): Promise<void> {
  await fastify.redis.hset(WATCH_KEY, watchField(w.user, w.orderId), JSON.stringify(w));
}

export function startTpslWatcher(fastify: FastifyInstance): void {
  const timer = setInterval(() => {
    tickTpslWatches(fastify).catch((err) => fastify.log.error({ err }, 'aster tpsl watcher tick'));
  }, TICK_MS);
  // Don't hold the process open on shutdown.
  timer.unref?.();
  fastify.addHook('onClose', async () => clearInterval(timer));
}
