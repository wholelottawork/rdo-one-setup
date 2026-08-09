import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config';
import '../types'; // fastify.redis decorator augmentation

export default fp(async (fastify) => {
  await fastify.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    ...(fastify.redisOk ? { redis: fastify.redis } : {}),
    // Fail open when the Redis store errors. This defaults to false, and the
    // default takes the whole backend down with Redis: the limiter runs as an
    // onRequest hook, so a store error is thrown BEFORE any handler runs and
    // every route — including /health, whose own try/catch never gets to
    // execute — answers 500. That turns "Redis is down, degrade the routes
    // that need it" into "the entire API is down", which is exactly what the
    // graceful-degradation work set out to prevent.
    //
    // Fail-open is the right trade here: while Redis is unreachable, requests
    // pass unlimited rather than being rejected. The exposure is bounded by
    // the outage, and the alternative is a guaranteed total outage instead of
    // a possible burst of abuse.
    skipOnError: true,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      error: 'Too many requests',
      statusCode: 429,
      retryAfter: 60,
    }),
  });
});
