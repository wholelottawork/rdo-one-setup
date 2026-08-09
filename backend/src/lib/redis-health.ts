import type { EventEmitter } from 'node:events';

// Live "is Redis usable right now?" tracking, split out of plugins/redis.ts so
// it can be tested against a fake emitter without a real Redis.
//
// It exists because a boot-time snapshot is wrong in both directions:
//   - Redis down at boot latched the flag false FOREVER, so every session and
//     money-path route kept returning 503 long after Redis recovered — only a
//     process restart cleared it. Under Compose, where the backend can win the
//     race against the redis service, that was the default outcome of `up`.
//   - Redis dying after a successful boot left the flag true, so guards that
//     mean to fail closed passed, and the unguarded call underneath threw —
//     a 500 where the code intended a 503.
//
// ioredis drives the transitions: `ready` means commands will be accepted,
// `close`/`end` mean they will not. Note that after a failed initial connect
// ioredis keeps retrying in the background, so `ready` can arrive minutes
// later with no restart — which is the entire point of tracking it live.

/** Just enough of Fastify's logger for this module; keeps the test dependency-free. */
export interface HealthLog {
  info(msg: string): void;
  warn(msg: string): void;
}

export interface RedisHealth {
  /** Current reachability. Read it per use — never copy it into a variable that outlives the request. */
  readonly ok: boolean;
}

/**
 * Subscribes to `client`'s lifecycle events and returns a live view of them.
 * Only transitions are logged, so a Redis that is down for an hour does not
 * produce an hour of reconnect noise.
 */
export function trackRedisHealth(client: EventEmitter, log: HealthLog): RedisHealth {
  let ok = false;

  const set = (next: boolean, event: string) => {
    if (next === ok) return;
    ok = next;
    if (next) log.info(`Redis available (${event})`);
    else log.warn(`Redis unavailable (${event}) — Redis-backed routes will return 503 until it returns`);
  };

  client.on('ready', () => set(true, 'ready'));
  client.on('close', () => set(false, 'close'));
  client.on('end', () => set(false, 'end'));

  return {
    get ok() {
      return ok;
    },
  };
}
