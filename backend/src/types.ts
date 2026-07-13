import type { Redis } from 'ioredis';

/**
 * Type the `redis` decorator that plugins/redis.ts attaches to the Fastify
 * instance, so `fastify.redis` is known everywhere without per-file casts.
 */
declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

/** Body shape for POST /api/aster-oi-bulk. */
export interface AsterOIBulkBody {
  symbols?: string[];
}

/** Query shape for the signed Aster passthrough routes (`user` is required). */
export interface AsterUserQuery {
  user?: string;
  [key: string]: string | undefined;
}
