import crypto from 'node:crypto';
import { verifyMessage } from 'ethers';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';

// Proof that the caller controls the `user` address they claim.
//
// The Aster V1 credentials this guards can MOVE FUNDS, and `user` is a public
// wallet address — without this, anyone who can reach the backend could name
// someone else's address and withdraw to an address of their choosing. Storing
// the secret server-side only helps if the endpoints that use it are bound to
// the person the secret belongs to.
//
// Per-request signature rather than a session cookie, deliberately: the
// signature covers the ACTION PARAMETERS, so it can't be lifted from one
// request and replayed with a different destination or amount. A stolen
// session cookie could be.
//
// The message format is duplicated in frontend/app/transfer/page.tsx
// (authMessage) and must match byte for byte — keep it dumb and stable.
const MAX_SKEW_MS = 5 * 60_000;

export function authMessage(
  action: string,
  user: string,
  params: Record<string, string>,
  timestamp: number,
): string {
  const body = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return [
    'RDO ONE authorization',
    `action: ${action}`,
    `user: ${user.toLowerCase()}`,
    `params: ${body}`,
    `timestamp: ${timestamp}`,
  ].join('\n');
}

interface VerifyArgs {
  redis: Redis;
  redisOk: boolean;
  reply: FastifyReply;
  action: string;
  user: unknown;
  params: Record<string, string>;
  timestamp: unknown;
  signature: unknown;
}

/**
 * Returns the verified lowercase address, or null after having already sent an
 * error response. Callers must key every subsequent lookup off the RETURNED
 * address, never off the request body's `user`.
 */
export async function verifyWalletAuth({
  redis, redisOk, reply, action, user, params, timestamp, signature,
}: VerifyArgs): Promise<string | null> {
  if (typeof user !== 'string' || !user) {
    reply.code(400).send({ msg: 'user required' });
    return null;
  }
  if (typeof signature !== 'string' || !signature) {
    reply.code(401).send({ msg: 'signature required — this action must be authorized by your wallet' });
    return null;
  }
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) {
    reply.code(401).send({ msg: 'Authorization expired — retry the action' });
    return null;
  }
  // The replay store is not optional: without it a captured signature is
  // reusable for the whole skew window.
  if (!redisOk) {
    reply.code(503).send({ msg: 'Authorization unavailable (Redis down)' });
    return null;
  }

  let recovered: string;
  try {
    recovered = verifyMessage(authMessage(action, user, params, ts), signature);
  } catch {
    reply.code(401).send({ msg: 'Bad signature' });
    return null;
  }
  if (recovered.toLowerCase() !== user.toLowerCase()) {
    reply.code(403).send({ msg: 'Signature does not match the requested account' });
    return null;
  }

  // Single use. SET NX means a replay inside the skew window loses the race.
  const digest = crypto.createHash('sha256').update(signature).digest('hex');
  const fresh = await redis.set(`auth:used:${digest}`, '1', 'PX', MAX_SKEW_MS * 2, 'NX');
  if (fresh === null) {
    reply.code(401).send({ msg: 'Authorization already used — retry the action' });
    return null;
  }

  return recovered.toLowerCase();
}
