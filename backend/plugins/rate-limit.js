import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';

export default fp(async (fastify) => {
  await fastify.register(rateLimit, {
    global: true,
    max: parseInt(process.env.RATE_LIMIT_MAX || '200'),
    timeWindow: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    redis: fastify.redis,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      error: 'Too many requests',
      statusCode: 429,
      retryAfter: 60,
    }),
  });
});
