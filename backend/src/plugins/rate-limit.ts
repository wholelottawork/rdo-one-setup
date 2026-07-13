import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import { config } from '../config';
import '../types'; // fastify.redis decorator augmentation

export default fp(async (fastify) => {
  await fastify.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    redis: fastify.redis,
    keyGenerator: (req) => req.ip,
    errorResponseBuilder: () => ({
      error: 'Too many requests',
      statusCode: 429,
      retryAfter: 60,
    }),
  });
});
