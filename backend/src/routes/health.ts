import type { FastifyInstance, FastifyReply } from 'fastify';
import { WATCH_KEY, getTpslWatcherStats, isTpslWatcherStalled, type TpslWatch } from '../lib/aster-tpsl-watcher';
import '../types'; // fastify.redis / fastify.redisOk decorator augmentation

// The container healthcheck and the uptime monitor poll this, so it has to
// report the failure that actually matters rather than only that the process
// is alive. Redis down means sessions, the signed-route replay guard and the
// TP/SL watcher are all out — the process answering 200 while none of that
// works is exactly the outage nobody gets paged for.
//
// The TP/SL block below exists for the same reason one level deeper. A free
// uptime monitor can check two things: the HTTP status, and whether a keyword
// appears in the body. So the hard failure (Redis) drives the STATUS, and the
// silent one (a watcher that has stopped placing user protections) is exposed
// as a literal `"tpslWatcherStalled":true` for a keyword monitor to match.
// See deploy/RUNBOOK.md § Uptime monitoring for the exact monitor config.
export default async function healthRoutes(fastify: FastifyInstance) {
  fastify.get('/health', async (_req, reply: FastifyReply) => {
    // Read once per request: `redisOk` is live, and a value that changed
    // between the check and the report would make the body self-contradictory.
    let redisOk = fastify.redisOk;

    // Pending TP/SL watches are user protections not yet placed. A count that
    // sits or climbs is the early warning that the watcher has stalled while
    // everything else still looks healthy.
    let pendingTpslWatches: number | null = null;
    // How long the oldest one has been waiting. The count alone cannot
    // distinguish "ten orders placed in the last minute" from "ten orders
    // whose fills were never noticed"; age can. Anything approaching the
    // watcher's 30-minute expiry is the second case.
    let oldestPendingTpslWatchMs: number | null = null;

    if (redisOk) {
      try {
        // hgetall rather than hlen because the age is worth the read: this
        // hash holds one entry per RESTING limit order with TP/SL attached, so
        // it is small by construction, and it self-limits — entries expire
        // after 30 minutes whatever happens.
        const all = await fastify.redis.hgetall(WATCH_KEY);
        const entries = Object.values(all ?? {});
        pendingTpslWatches = entries.length;
        const now = Date.now();
        for (const raw of entries) {
          try {
            const { createdAt } = JSON.parse(raw) as TpslWatch;
            if (typeof createdAt !== 'number') continue;
            const age = now - createdAt;
            if (oldestPendingTpslWatchMs === null || age > oldestPendingTpslWatchMs) {
              oldestPendingTpslWatchMs = age;
            }
          } catch {
            // A corrupt entry is the watcher's problem to clean up, not a
            // reason for the health check to fail.
          }
        }
      } catch {
        // The flag said up but the command failed — believe the command.
        redisOk = false;
        pendingTpslWatches = null;
      }
    }

    const w = getTpslWatcherStats();
    const stalled = isTpslWatcherStalled();

    // 503 so Docker restarts the container and the monitor pages, instead of
    // both reading 200 off a backend that can't serve a trade.
    //
    // Deliberately NOT driven by `stalled`: a stalled watcher is usually
    // Aster being unreachable, and restarting this container fixes nothing
    // while taking down trading, market data and the price relay — all of
    // which still work. It is reported, loudly, and left to a human.
    if (!redisOk) reply.code(503);

    return {
      // Existing consumers read `status` and `uptime`; everything below is additive.
      status: redisOk ? 'ok' : 'degraded',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      redis: redisOk ? 'up' : 'down',
      pendingTpslWatches,
      oldestPendingTpslWatchMs,
      // Flat, top-level and literally spelled so a keyword monitor can match
      // `"tpslWatcherStalled":true` without JSON support.
      tpslWatcherStalled: stalled,
      tpslWatcher: {
        running: w.running,
        lastPassAt: w.lastPassAt ? new Date(w.lastPassAt).toISOString() : null,
        lastPassAgeMs: w.lastPassAt ? Date.now() - w.lastPassAt : null,
        lastPassDurationMs: w.lastPassDurationMs,
        lastPassErrors: w.lastPassErrors,
        consecutiveFailingPasses: w.consecutiveFailingPasses,
        lastError: w.lastError,
        lastErrorAt: w.lastErrorAt ? new Date(w.lastErrorAt).toISOString() : null,
        // Since boot. `placed` flat while `pendingTpslWatches` climbs is the
        // exact shape of the silent failure this endpoint exists to expose.
        placed: w.placed,
        expired: w.expired,
        failed: w.failed,
      },
    };
  });
}
