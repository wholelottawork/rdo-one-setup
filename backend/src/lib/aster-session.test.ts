// Run: npm test   (tsx, same runtime the server uses — no test framework)
import assert from 'node:assert/strict';
import type { Redis } from 'ioredis';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { peekSession, readSessionToken, requireSession, startSession } from './aster-session.ts';

// Smallest thing that behaves like the two Redis calls this module makes.
function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    set: async (k: string, v: string) => { store.set(k, v); return 'OK'; },
    get: async (k: string) => store.get(k) ?? null,
    del: async (k: string) => (store.delete(k) ? 1 : 0),
  };
}

function fakeReply() {
  const headers: Record<string, string> = {};
  const sent: Array<{ code: number; body: unknown }> = [];
  let code = 200;
  const reply = {
    headers, sent,
    header: (k: string, v: string) => { headers[k.toLowerCase()] = v; return reply; },
    code: (c: number) => { code = c; return reply; },
    send: (body: unknown) => { sent.push({ code, body }); return reply; },
  };
  return reply;
}

const req = (cookie?: string) =>
  ({ headers: cookie ? { cookie } : {} }) as unknown as FastifyRequest;

// ── The cookie must survive company in the header ─────────────────────────
assert.equal(readSessionToken(req('rdo_sess=abc123')), 'abc123');
assert.equal(readSessionToken(req('theme=dark; rdo_sess=abc123; other=1')), 'abc123');
assert.equal(readSessionToken(req('theme=dark')), null, 'unrelated cookies are not a session');
assert.equal(readSessionToken(req()), null, 'no Cookie header at all');
// A cookie whose NAME merely ends in ours must not be mistaken for it.
assert.equal(readSessionToken(req('not_rdo_sess=nope')), null, 'suffix match is not a match');

// ── Minting ───────────────────────────────────────────────────────────────
const redis = fakeRedis();
const reply = fakeReply();
const ttl = await startSession(redis as unknown as Redis, reply as unknown as FastifyReply, '0xAbC0000000000000000000000000000000000001');

assert.ok(ttl > 0, 'session has a lifetime');
const setCookie = reply.headers['set-cookie'];
assert.match(setCookie, /HttpOnly/, 'script in the page must not be able to read the token');
assert.match(setCookie, /SameSite=Strict/, 'no other site may send this cookie — that is the CSRF story');
assert.match(setCookie, /Max-Age=\d+/, 'the session has to expire on its own');

const token = readSessionToken(req(setCookie.split(';')[0]));
assert.ok(token && token.length >= 32, 'token is not guessable-short');

// The token itself must never be what is stored — a Redis dump would
// otherwise hand over live sessions.
const [storedKey, storedValue] = [...redis.store.entries()][0];
assert.ok(!storedKey.includes(token!), 'token is stored hashed, not raw');
assert.equal(storedValue, '0xabc0000000000000000000000000000000000001', 'address is normalized lowercase');

// ── Reading it back ───────────────────────────────────────────────────────
const cookieHeader = `rdo_sess=${token}`;
assert.equal(
  await peekSession(redis as unknown as Redis, req(cookieHeader)),
  '0xabc0000000000000000000000000000000000001',
);

const fastify = { redis: redis as unknown as Redis, redisOk: true };
assert.equal(
  await requireSession(fastify, req(cookieHeader), fakeReply() as unknown as FastifyReply),
  '0xabc0000000000000000000000000000000000001',
  'a live session resolves to its own address',
);

// ── The whole point: no session, no account ───────────────────────────────
const noCookie = fakeReply();
assert.equal(await requireSession(fastify, req(), noCookie as unknown as FastifyReply), null);
assert.equal(noCookie.sent[0]?.code, 401, 'missing session is 401, never a fallback to some address');

const madeUp = fakeReply();
assert.equal(
  await requireSession(fastify, req('rdo_sess=' + 'f'.repeat(64)), madeUp as unknown as FastifyReply),
  null,
  'a token nobody minted is not a session',
);
assert.equal(madeUp.sent[0]?.code, 401);

// Redis down must fail closed — an unverifiable session is not a valid one.
const noRedis = fakeReply();
assert.equal(
  await requireSession({ redis: redis as unknown as Redis, redisOk: false }, req(cookieHeader), noRedis as unknown as FastifyReply),
  null,
);
assert.equal(noRedis.sent[0]?.code, 503);

console.log('aster-session: all checks passed');
