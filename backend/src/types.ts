import type { Redis } from 'ioredis';

/**
 * Type the `redis` decorator that plugins/redis.ts attaches to the Fastify
 * instance, so `fastify.redis` is known everywhere without per-file casts.
 */
declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
    /**
     * Whether Redis is reachable RIGHT NOW. Backed by a getter, so it is
     * readonly and must be read at the point of use — copying it into a
     * long-lived variable reintroduces the stale-snapshot bug it replaced.
     * Even a `true` read races with a Redis that dies a millisecond later, so
     * callers on money paths must also survive the command throwing.
     */
    readonly redisOk: boolean;
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
