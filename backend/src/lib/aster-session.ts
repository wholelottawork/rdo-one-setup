import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { config } from '../config';

// A trading session for the /aster-signed/* and /aster-tpsl-watch surface.
//
// Those routes act on an Aster account using the caller's own server-held
// agent key, and used to choose which key by reading `user` straight off the
// request. A wallet address is PUBLIC — so anyone who could reach the backend
// could name someone else's address and trade their account. The agent keys
// are registered `canWithdraw: false`, so funds can't be moved off the
// exchange, but a position can still be opened, closed, or run into a
// liquidation on someone else's money.
//
// Per-request signatures (lib/wallet-auth.ts, used by the V1 withdraw routes)
// are the stronger primitive: they bind to the exact parameters they
// authorize. They're the wrong tool here — every order, cancel and TP/SL edit
// would pop the wallet, and prompt-free trading after one agent approval is
// the entire point of the Aster integration. So: one wallet signature to open
// a session, a bearer cookie for the hot path afterwards.
//
// What that trade buys and costs, explicitly: a stolen cookie can trade this
// account until it expires. It cannot withdraw (agent keys can't), it cannot
// touch the V1 credential/withdraw routes (still per-request signed), and it
// can't be read out of the page by injected script (HttpOnly) or sent by
// another site (SameSite=Strict).
const SESSION_TTL_S = 12 * 60 * 60;
const COOKIE = 'rdo_sess';

// Stored hashed: a dump of Redis then yields no usable session tokens.
const redisKey = (token: string) =>
  `sess:${crypto.createHash('sha256').update(token).digest('hex')}`;

function cookie(value: string, maxAge: number): string {
  return [
    `${COOKIE}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${maxAge}`,
    ...(config.isProd ? ['Secure'] : []),
  ].join('; ');
}

/** The raw token from the request's Cookie header, or null. */
export function readSessionToken(req: Pick<FastifyRequest, 'headers'>): string | null {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

/**
 * Redis went away mid-request. Distinct from "no session" so callers answer
 * 503 rather than 401 (which would tell a user with a perfectly good session
 * to re-sign, and the re-sign would fail too) and never 500.
 *
 * `redisOk` is checked before these calls, but it is a live flag, not a lease:
 * Redis can die in the gap. This is that gap.
 */
export class RedisUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Redis unavailable', { cause });
    this.name = 'RedisUnavailableError';
  }
}

/** Mints a session for an ALREADY-VERIFIED address and sets the cookie.
 *  Returns null after having sent a 503 if the session store is unreachable —
 *  minting a cookie whose token was never stored would hand the caller a
 *  session that fails on its very next request. */
export async function startSession(
  redis: Redis, reply: FastifyReply, user: string,
): Promise<number | null> {
  const token = crypto.randomBytes(32).toString('hex');
  try {
    await redis.set(redisKey(token), user.toLowerCase(), 'EX', SESSION_TTL_S);
  } catch {
    reply.code(503).send({ code: 503, msg: 'Sessions unavailable (Redis down)' });
    return null;
  }
  reply.header('set-cookie', cookie(token, SESSION_TTL_S));
  return SESSION_TTL_S;
}

/** Clears the cookie either way — a browser that can't reach Redis should
 *  still end up logged out rather than holding a token it thinks is live. */
export async function endSession(
  redis: Redis, req: FastifyRequest, reply: FastifyReply, redisOk: boolean,
): Promise<void> {
  const token = readSessionToken(req);
  // Swallowed on purpose, and only here: the server-side row expires on its
  // own TTL, and the caller asked to be logged OUT — answering 503 would leave
  // them holding a live cookie. Clearing it is the part that must not fail.
  if (token && redisOk) await redis.del(redisKey(token)).catch(() => {});
  reply.header('set-cookie', cookie('', 0));
}

/** The session's address, or null — no response sent. For "do I have one?".
 *  Throws RedisUnavailableError rather than returning null when the store is
 *  unreachable: "unknown" must not be squashed into "not logged in". */
export async function peekSession(redis: Redis, req: FastifyRequest): Promise<string | null> {
  const token = readSessionToken(req);
  if (!token) return null;
  try {
    return await redis.get(redisKey(token));
  } catch (err) {
    throw new RedisUnavailableError(err);
  }
}

/**
 * The verified lowercase address for this request, or null after having
 * already sent the error response. Callers must use the RETURNED address and
 * ignore any `user` in the query or body — that's the whole point.
 *
 * 401 specifically means "no/expired session" and nothing else on these
 * routes: Aster's own rejections come back through signedPassthrough as a
 * 200 carrying {code, msg}. The frontend relies on that to know a retry
 * after re-signing is safe (nothing reached the exchange).
 */
export async function requireSession(
  fastify: { redis: Redis; redisOk: boolean },
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  if (!readSessionToken(req)) {
    reply.code(401).send({ code: 401, msg: 'No trading session — authorize with your wallet' });
    return null;
  }
  if (!fastify.redisOk) {
    reply.code(503).send({ code: 503, msg: 'Sessions unavailable (Redis down)' });
    return null;
  }
  let user: string | null;
  try {
    user = await peekSession(fastify.redis, req);
  } catch {
    reply.code(503).send({ code: 503, msg: 'Sessions unavailable (Redis down)' });
    return null;
  }
  if (!user) {
    reply.code(401).send({ code: 401, msg: 'Trading session expired — authorize with your wallet' });
    return null;
  }
  return user;
}
