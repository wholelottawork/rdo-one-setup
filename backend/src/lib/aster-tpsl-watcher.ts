import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { signAsterV3RequestAs } from './aster-auth';
import { getOrCreateUserAgent } from './agent-keystore';
import { moneyLog, moneyWarn } from './money-log';

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
/** The pending-watch hash. Exported so routes/health.ts reports its depth
 *  without a second copy of the string drifting from this one. */
export const WATCH_KEY = 'aster:tpsl-watch';
const LOCK_KEY = 'aster:tpsl-lock';
const TICK_MS = 5_000;
// Comfortably longer than a pass over every pending watch. If a pass somehow
// overruns this, the lock frees and another instance may start a second pass —
// the TTL is what bounds the damage, so keep it well above the real worst case.
const LOCK_MS = 30_000;
// Matches the browser watcher this replaces. A limit still resting after this
// long is a stale intention, not a pending fill.
const MAX_AGE_MS = 30 * 60_000;

// ── Stall detection ──────────────────────────────────────────────────────────
// This watcher is the one background job holding user money open, and its
// failure mode is silent by construction: nothing throws, no request 500s, the
// UI looks fine, and stop-losses simply never get placed. The pending count in
// /health rises and nothing else moves.
//
// So the watcher reports on itself, and /health surfaces it. Two conditions
// count as stalled, and neither is "the count is high" — a resting limit order
// legitimately sits pending for up to MAX_AGE_MS, so depth alone is a normal
// state, not a fault:
//
//   1. no pass has COMPLETED within STALL_AFTER_MS. Either the interval is
//      dead, or a crashed instance left the Redis lock held.
//   2. FAILING_PASSES_TO_STALL passes in a row hit at least one upstream
//      error. Aster is unreachable, fills cannot be detected, and every
//      pending watch is an unprotected position waiting to happen.
//
// Growth is still worth alerting on — but as a threshold a human sets on
// pendingTpslWatches, not as something this file pretends to infer.

/** ~6 ticks. Long enough that one slow pass or a lost lock race is not an
 *  alert; short enough that a dead watcher is caught within half a minute. */
const STALL_AFTER_MS = 30_000;
const FAILING_PASSES_TO_STALL = 3;

export interface TpslWatcherStats {
  /** Epoch ms of the last pass that ran to completion (lock acquired, hash
   *  walked). Null until the first one — which is itself the boot state, not
   *  a stall, hence `startedAt` below. */
  lastPassAt: number | null;
  lastPassDurationMs: number | null;
  /** Upstream failures seen in the most recent pass, and how many consecutive
   *  passes have had at least one. */
  lastPassErrors: number;
  consecutiveFailingPasses: number;
  /** Scrubbed message of the most recent failure — enough to tell a 429 from
   *  a DNS failure without opening the log. */
  lastError: string | null;
  lastErrorAt: number | null;
  /** Cumulative since boot. `placed` not rising while `pending` does is the
   *  shape of the silent failure this whole block exists for. */
  placed: number;
  expired: number;
  failed: number;
  startedAt: number;
  running: boolean;
}

const stats: TpslWatcherStats = {
  lastPassAt: null,
  lastPassDurationMs: null,
  lastPassErrors: 0,
  consecutiveFailingPasses: 0,
  lastError: null,
  lastErrorAt: null,
  placed: 0,
  expired: 0,
  failed: 0,
  startedAt: Date.now(),
  running: false,
};

/** True when the watcher cannot be trusted to be placing protections. Read by
 *  routes/health.ts, which is what an uptime monitor can actually see. */
export function isTpslWatcherStalled(now = Date.now()): boolean {
  if (!stats.running) return false; // not started (e.g. a unit test) is not stalled
  const since = stats.lastPassAt ?? stats.startedAt;
  if (now - since > STALL_AFTER_MS) return true;
  return stats.consecutiveFailingPasses >= FAILING_PASSES_TO_STALL;
}

export function getTpslWatcherStats(): Readonly<TpslWatcherStats> {
  return stats;
}

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

/** What Aster returns on a rejected order: HTTP 200 with a negative `code`.
 *  A leg that comes back like this placed NOTHING. */
interface AsterOrderReply { code?: number; msg?: string; orderId?: number | string }

/** Outcome of one trigger leg, for the log line — never the request. */
interface LegResult { type: string; ok: boolean; orderId?: string; code?: number; msg?: string }

async function placeTriggers(fastify: FastifyInstance, w: TpslWatch): Promise<LegResult[]> {
  const legs: Promise<LegResult>[] = [];
  const leg = async (type: string, stopPrice: string): Promise<LegResult> => {
    const r = (await asterCall(fastify, w.user, '/fapi/v3/order', {
      symbol: w.symbol,
      side: w.side,
      type,
      stopPrice,
      workingType: 'MARK_PRICE',
      // Closes whatever is actually open when it fires, so a partial fill
      // can't leave an oversized trigger behind.
      closePosition: 'true',
    }, 'POST')) as AsterOrderReply;
    // A rejected leg used to be indistinguishable from a placed one: the reply
    // was discarded, the watch was deleted, and the position was left with no
    // stop-loss and no record of it anywhere. Reading the reply is the whole
    // point — nothing about WHICH legs get placed changes here, only whether
    // you can find out afterwards.
    return typeof r?.code === 'number' && r.code < 0
      ? { type, ok: false, code: r.code, msg: typeof r.msg === 'string' ? r.msg : undefined }
      : { type, ok: true, orderId: r?.orderId != null ? String(r.orderId) : undefined };
  };
  if (w.tpPrice) legs.push(leg('TAKE_PROFIT_MARKET', w.tpPrice));
  if (w.slPrice) legs.push(leg('STOP_MARKET', w.slPrice));
  return Promise.all(legs);
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
  const startedAt = Date.now();
  try {
    const errors = await runTpslPass(fastify);
    // Recorded only on a pass that actually completed, because that is what
    // `stalled` asks about: not "did the interval fire" but "did a full walk
    // of the pending hash finish".
    stats.lastPassAt = Date.now();
    stats.lastPassDurationMs = stats.lastPassAt - startedAt;
    stats.lastPassErrors = errors;
    stats.consecutiveFailingPasses = errors > 0 ? stats.consecutiveFailingPasses + 1 : 0;
    reportStallTransition(fastify);
  } finally {
    // Release only if it's still ours — a pass that overran LOCK_MS must not
    // free the lock another instance has since taken.
    if (await fastify.redis.get(LOCK_KEY) === token) await fastify.redis.del(LOCK_KEY);
  }
}

/** @returns how many watches hit an upstream failure this pass — the input to
 *  the stall check, and the number that says "fills are not being detected". */
async function runTpslPass(fastify: FastifyInstance): Promise<number> {
  const all = await fastify.redis.hgetall(WATCH_KEY);
  let errors = 0;
  for (const [field, raw] of Object.entries(all ?? {})) {
    let w: TpslWatch;
    try {
      w = JSON.parse(raw) as TpslWatch;
    } catch {
      await fastify.redis.hdel(WATCH_KEY, field);
      fastify.log.warn({ field }, 'aster tpsl watch dropped — unparseable');
      continue;
    }
    if (Date.now() - w.createdAt > MAX_AGE_MS) {
      await fastify.redis.hdel(WATCH_KEY, field);
      stats.expired += 1;
      // Money stream, not the general log: this is a protection that was
      // promised and then legitimately never needed, and the record of that
      // has to survive production's `warn` level like every other money event.
      moneyLog(fastify, 'tpsl.expired', {
        user: w.user, symbol: w.symbol, orderId: w.orderId,
        ageMs: Date.now() - w.createdAt,
      });
      continue;
    }
    try {
      const o = (await asterCall(fastify, w.user, '/fapi/v3/order', {
        symbol: w.symbol,
        orderId: w.orderId,
      }, 'GET')) as { executedQty?: string; status?: string };

      // Any execution at all — partial counts, that's a real position.
      if (parseFloat(o?.executedQty ?? '0') > 0) {
        const legs = await placeTriggers(fastify, w);
        await fastify.redis.hdel(WATCH_KEY, field);
        const rejected = legs.filter((l) => !l.ok);
        const line = {
          user: w.user, symbol: w.symbol, orderId: w.orderId, side: w.side,
          executedQty: o.executedQty,
          // Prices, not signatures: these are the numbers the user chose, and
          // they are the whole answer to "was my stop where I set it?".
          tpPrice: w.tpPrice ?? null, slPrice: w.slPrice ?? null,
          legs,
        };
        if (rejected.length) {
          // The position is open and at least one protection is NOT on it.
          // Highest-consequence outcome in this file; it gets a `warn` in the
          // money stream so it is greppable next to the placements it failed
          // to join.
          stats.failed += 1;
          moneyWarn(fastify, 'tpsl.failed', line);
        } else {
          stats.placed += 1;
          moneyLog(fastify, 'tpsl.placed', line);
        }
      } else if (['CANCELED', 'EXPIRED', 'REJECTED'].includes(String(o?.status))) {
        await fastify.redis.hdel(WATCH_KEY, field);
        fastify.log.info({ field, status: o?.status }, 'aster tpsl watch dropped — order gone');
      }
    } catch (err) {
      // Transient upstream failure — leave the watch in place and retry next
      // tick rather than dropping a position's protection on one bad response.
      // Correct behaviour, and until now completely invisible: it retried
      // forever without anything above `warn` ever saying so. The counter is
      // what turns a run of these into the `stalled` flag on /health.
      errors += 1;
      stats.lastError = String((err as Error)?.message ?? err).slice(0, 200);
      stats.lastErrorAt = Date.now();
      fastify.log.warn({ err, field, symbol: w.symbol }, 'aster tpsl watch tick failed');
    }
  }
  return errors;
}

// One line per stall, and one per recovery — not one per tick. At a 5s
// interval the alternative is 720 identical `error` lines an hour, which is
// how a real signal gets trained out of you.
let reportedStall = false;

function reportStallTransition(fastify: FastifyInstance): void {
  const stalled = isTpslWatcherStalled();
  if (stalled === reportedStall) return;
  reportedStall = stalled;
  if (stalled) {
    fastify.log.error(
      {
        consecutiveFailingPasses: stats.consecutiveFailingPasses,
        lastPassErrors: stats.lastPassErrors,
        lastError: stats.lastError,
        lastPassAt: stats.lastPassAt,
      },
      'aster tpsl watcher STALLED — pending protections are not being placed',
    );
  } else {
    fastify.log.warn({ lastPassAt: stats.lastPassAt }, 'aster tpsl watcher recovered');
  }
}

export async function addTpslWatch(fastify: FastifyInstance, w: TpslWatch): Promise<void> {
  await fastify.redis.hset(WATCH_KEY, watchField(w.user, w.orderId), JSON.stringify(w));
  // The promise side of the money trail: this is where the app takes on the
  // obligation that `tpsl.placed` later discharges. Without this line, an
  // armed-but-never-placed protection leaves no evidence it was ever promised.
  moneyLog(fastify, 'tpsl.armed', {
    user: w.user, symbol: w.symbol, orderId: w.orderId, side: w.side,
    tpPrice: w.tpPrice ?? null, slPrice: w.slPrice ?? null,
  });
}

export function startTpslWatcher(fastify: FastifyInstance): void {
  stats.running = true;
  stats.startedAt = Date.now();
  const timer = setInterval(() => {
    // `.finally`, not just `.catch`: tickTpslWatches returns early when Redis
    // is down or the lock is held, and a stall that begins that way would
    // otherwise never produce a log line — /health would say `stalled` while
    // the log said nothing at all.
    tickTpslWatches(fastify).catch((err) => {
      // Reaching here means the LOCK or Redis itself failed, not one watch —
      // runTpslPass swallows per-watch errors. Count it as a failing pass so a
      // Redis outage shows up as `stalled` too, which it is: no fills are
      // being detected.
      stats.consecutiveFailingPasses += 1;
      stats.lastError = String((err as Error)?.message ?? err).slice(0, 200);
      stats.lastErrorAt = Date.now();
      fastify.log.error({ err }, 'aster tpsl watcher tick');
    }).finally(() => reportStallTransition(fastify));
  }, TICK_MS);
  // Don't hold the process open on shutdown.
  timer.unref?.();
  fastify.addHook('onClose', async () => {
    clearInterval(timer);
    stats.running = false;
  });
}
