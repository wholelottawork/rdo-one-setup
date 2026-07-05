import fp from 'fastify-plugin';
import Redis from 'ioredis';

export default fp(async (fastify) => {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  redis.on('error', (err) => fastify.log.warn({ err }, 'Redis error'));

  try {
    await redis.connect();
    fastify.log.info('Redis connected');
  } catch (err) {
    fastify.log.warn({ err }, 'Redis unavailable — running without cache');
  }

  fastify.decorate('redis', redis);
  fastify.addHook('onClose', async () => redis.quit().catch(() => {}));
});
