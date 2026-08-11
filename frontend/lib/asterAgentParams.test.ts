// Run: npm test   (node strips the types natively, no test framework)
//
// Guards the bug that shipped: /aster-agent-params had no rewrite in
// next.config.js, so the lookup 404'd, approveAsterAgent swallowed it as
// "withdrawals are off", and every user was silently given a TRADE-ONLY agent.
// It surfaced much later as Aster answering "Invalid API-key, IP, or
// permissions for action" at withdrawal time — pointing at Aster rather than at
// a missing proxy line, and by then the agent could not be amended.
//
// Two things are pinned here:
//   1. every backend path the browser calls has a rewrite (catches the class);
//   2. an unreachable/404 lookup FAILS rather than minting a trade-only agent
//      (catches the consequence, whatever the cause).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fetchAsterAgentParams } from './asterAgentParams.ts';

// ── 1. Every backend path the browser fetches must be proxied ─────────────
const config = readFileSync(new URL('../next.config.js', import.meta.url), 'utf8');
const sources = new Set(
  [...config.matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1].replace('/:path*', '')),
);

// Grepped by hand rather than parsed: these are the literal paths the Aster
// client code fetches. Add to this list when you add an endpoint.
for (const path of [
  '/aster-agent-params',
  '/aster-agent-address',
  '/aster-approve-agent',
  '/aster-session',
  '/aster-signed',
  '/aster-withdraw',
  '/aster-withdraw-fee',
  '/aster-withdraw-info',
]) {
  assert.ok(sources.has(path), `${path} is fetched by the browser but has no next.config.js rewrite`);
}

// ── 2. A failed params lookup must fail closed, not report "no withdrawals" ─
const realFetch = globalThis.fetch;

async function params(impl: () => Promise<Response>) {
  globalThis.fetch = impl as typeof fetch;
  try {
    return await fetchAsterAgentParams();
  } finally {
    globalThis.fetch = realFetch;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// 404 — exactly the missing-rewrite case. Must NOT read as "withdrawals off",
// because callers would then mint an agent Aster will never let them amend.
{
  const r = await params(async () => new Response('Not Found', { status: 404 }));
  assert.equal(r.ok, false, 'a 404 on agent params must fail closed');
  assert.match(r.message, /aster-agent-params/);
}

// Network failure — same rule, different cause.
{
  const r = await params(async () => { throw new Error('offline'); });
  assert.equal(r.ok, false, 'an unreachable backend must fail closed');
  assert.ok(r.message.length > 0, 'a failure must say why');
  assert.equal(r.canWithdraw, false);
}

// Malformed bodies must not be read as a deliberate "off" either.
for (const body of [{ nonsense: true }, { ipWhitelist: 123 }, null]) {
  const r = await params(async () => json(body));
  assert.equal(r.ok, false, `malformed body ${JSON.stringify(body)} must fail closed`);
}

// A deployment with no static IP is a VALID answer: trade-only is deliberate
// there and Aster rejects canWithdraw without an IP anyway, so this must
// succeed rather than block trading.
{
  const r = await params(async () => json({ ipWhitelist: '', canWithdraw: false }));
  assert.deepEqual(r, { ok: true, ipWhitelist: '', canWithdraw: false, message: '' });
}

// canWithdraw is never asked for without an IP to pin it to — Aster answers
// "api withdraw permission must specify IP." and fails the whole approval.
{
  const r = await params(async () => json({ ipWhitelist: '', canWithdraw: true }));
  assert.equal(r.canWithdraw, false, 'canWithdraw without an IP must be dropped');
}

// The configured case.
{
  const r = await params(async () => json({ ipWhitelist: '203.0.113.9', canWithdraw: true }));
  assert.deepEqual(r, { ok: true, ipWhitelist: '203.0.113.9', canWithdraw: true, message: '' });
}

console.log('asterAgentParams: all checks passed');
