import fp from 'fastify-plugin';
import Redis from 'ioredis';
import { config } from '../config';
import { trackRedisHealth } from '../lib/redis-health';
import '../types'; // fastify.redis decorator augmentation

export default fp(async (fastify) => {
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  // ioredis retries a dead connection roughly twice a second, and each attempt
  // emits an `error`. Logging every one turns a Redis outage into ~40k lines a
  // day of the same ECONNREFUSED — which does not tell you anything the first
  // line didn't, and, with Docker's 10MB × 3 rotation (docker-compose.yml),
  // scrolls every other log line off the box inside two days. The outage would
  // destroy the evidence of whatever caused it.
  //
  // So: log the first occurrence immediately, then at most one line a minute
  // while the error is unchanged, carrying the count of what was suppressed.
  // A DIFFERENT error always logs immediately — a change of failure mode
  // (auth failure after a connection refusal) is new information.
  const ERROR_LOG_INTERVAL_MS = 60_000;
  let lastErrorKey: string | null = null;
  let lastErrorLoggedAt = 0;
  let suppressedErrors = 0;

  redis.on('error', (err: Error & { code?: string }) => {
    const key = `${err.code ?? ''}:${err.message}`;
    const now = Date.now();
    if (key === lastErrorKey && now - lastErrorLoggedAt < ERROR_LOG_INTERVAL_MS) {
      suppressedErrors += 1;
      return;
    }
    fastify.log.warn(
      { err, ...(suppressedErrors ? { suppressedSince: suppressedErrors } : {}) },
      'Redis error',
    );
    lastErrorKey = key;
    lastErrorLoggedAt = now;
    suppressedErrors = 0;
  });

  // Wire the health tracker BEFORE connecting, so a connection that becomes
  // ready during the await below is not missed.
  const health = trackRedisHealth(redis, {
    // Both at `warn`, including the "available" transition. Production logs at
    // `warn`, so routing recovery to `info` would show the outage and hide the
    // end of it — a log where Redis goes down and never comes back reads as an
    // ongoing incident long after it is over.
    info: (msg) => fastify.log.warn(msg),
    warn: (msg) => fastify.log.warn(msg),
  });

  try {
    await redis.connect();
  } catch (err) {
    // Not fatal, and deliberately not a latched failure: ioredis keeps
    // retrying in the background per its retryStrategy, and `health.ok` flips
    // to true on the `ready` event whenever Redis shows up. Boot order under
    // Compose stops mattering.
    fastify.log.warn({ err }, 'Redis unavailable at boot — retrying in the background');
  }

  fastify.decorate('redis', redis);
  // A getter, not a value. `decorate('redisOk', someBoolean)` copies the
  // boolean once and every later read is stale — which was the bug.
  fastify.decorate('redisOk', { getter: () => health.ok });

  fastify.addHook('onClose', async () => {
    await redis.quit().catch(() => {});
  });
});
