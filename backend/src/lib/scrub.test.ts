// Run: npm test   (tsx strips the types, no test framework)
import assert from 'node:assert/strict';
import { REDACTED, isSecretBodyPath, isSecretKey, scrubDeep, scrubString, scrubUrl } from './scrub.ts';

// Realistic shapes, not placeholders: every literal below is the same length
// and alphabet as the real value, because the whole mechanism is shape-based
// and a short fake would pass a test the real secret fails.
const SIG = '0x' + 'a1'.repeat(65);                 // 65-byte ECDSA signature
const PRIVKEY = '0x' + 'b2'.repeat(32);             // 32-byte private key
const SESSION_ID = 'c3'.repeat(32);                 // 64 hex, no 0x — session id
const ENCRYPTION_SECRET = 'd4'.repeat(32);          // AGENT_KEY_ENCRYPTION_SECRET

// ── Key names ────────────────────────────────────────────────────────────────

for (const k of [
  'apiKey', 'API_KEY', 'apiSecret', 'signature', 'userSignature', 'privateKey',
  'private_key', 'agentKey', 'AGENT_KEY_ENCRYPTION_SECRET', 'Cookie', 'set-cookie',
  'authorization', 'listenKey', 'sig', 'password',
]) {
  assert.equal(isSecretKey(k), true, `${k} must be treated as secret`);
}

// Ordinary trading fields must survive — a redactor that eats `symbol` and
// `quantity` makes the money log useless and gets turned off.
for (const k of ['symbol', 'side', 'quantity', 'price', 'orderId', 'user', 'chainId', 'nonce', 'receiver']) {
  assert.equal(isSecretKey(k), false, `${k} must NOT be redacted`);
}

// ── Value shapes, whatever key they arrive under ─────────────────────────────

assert.equal(scrubString(SIG), REDACTED);
assert.equal(scrubString(PRIVKEY), REDACTED);
assert.equal(scrubString(SESSION_ID), REDACTED);

// The case the key-name list cannot catch: a secret interpolated into prose.
// This is how they actually escape — through an error message, not a field.
assert.equal(
  scrubString(`Signature check failed for ${SIG} on order 12345`),
  `Signature check failed for ${REDACTED} on order 12345`,
);
assert.ok(!scrubString(`boom ${ENCRYPTION_SECRET}`).includes(ENCRYPTION_SECRET));

// An address is 40 hex, not 64 — it is public and must stay readable, or every
// money log line loses the "who".
const ADDRESS = '0x' + 'ab'.repeat(20);
assert.equal(scrubString(`user ${ADDRESS} withdrew`), `user ${ADDRESS} withdrew`);
// A tx hash is 64 hex and IS redacted. That is a deliberate trade: the same
// shape as a private key, and no way to tell them apart from the value alone.
assert.equal(scrubString('0x' + 'ef'.repeat(32)), REDACTED);

// ── Deep walk ────────────────────────────────────────────────────────────────

const event = {
  message: `failed: ${SIG}`,
  request: {
    headers: { cookie: 'rdo_sess=abc123', 'content-type': 'application/json' },
    body: { symbol: 'BTCUSDT', quantity: '0.01', signature: SIG, userSignature: SIG },
  },
  extra: { nested: { deep: { privateKey: PRIVKEY, note: `key is ${PRIVKEY}` } } },
};
const clean = scrubDeep(event);

assert.equal(clean.message, `failed: ${REDACTED}`);
assert.equal(clean.request.headers.cookie, REDACTED);
assert.equal(clean.request.headers['content-type'], 'application/json');
assert.equal(clean.request.body.symbol, 'BTCUSDT', 'non-secret fields survive');
assert.equal(clean.request.body.quantity, '0.01');
assert.equal(clean.request.body.signature, REDACTED);
assert.equal(clean.request.body.userSignature, REDACTED);
assert.equal(clean.extra.nested.deep.privateKey, REDACTED);
assert.equal(clean.extra.nested.deep.note, `key is ${REDACTED}`);

// The input must not be mutated: it may be a live request body still on its
// way to Aster, and rewriting a signature in place would break the request.
assert.equal(event.request.body.signature, SIG, 'scrubDeep must not mutate its input');

// Belt and braces: nothing secret-shaped survives anywhere in the output.
const serialized = JSON.stringify(clean);
for (const secret of [SIG, PRIVKEY]) {
  assert.ok(!serialized.includes(secret), 'no secret may survive serialization');
}

// Arrays and nulls are walked, not dropped.
assert.deepEqual(scrubDeep({ legs: [{ ok: true }, { signature: SIG }], none: null }),
  { legs: [{ ok: true }, { signature: REDACTED }], none: null });

// Cycles terminate rather than hanging the logger.
const cyclic: Record<string, unknown> = { a: 1 };
cyclic.self = cyclic;
assert.doesNotThrow(() => JSON.stringify(scrubDeep(cyclic)));

// ── URLs ─────────────────────────────────────────────────────────────────────

// This is the one that mattered most: Fastify logs req.url by default, and on
// /aster-signed/* that URL is the entire signed request.
const signedUrl = `/aster-signed/fapi/v3/order?symbol=BTCUSDT&user=${ADDRESS}&signature=${SIG.slice(2)}`;
const scrubbed = scrubUrl(signedUrl);
assert.ok(scrubbed.startsWith('/aster-signed/fapi/v3/order?'), 'the path stays readable');
assert.ok(scrubbed.includes('symbol=BTCUSDT'), 'non-secret params stay readable');
assert.ok(!scrubbed.includes(SIG.slice(2)), 'the signature must not survive');

// A URL with no query string is returned intact.
assert.equal(scrubUrl('/health'), '/health');

// ── Money-route bodies ───────────────────────────────────────────────────────

for (const p of [
  '/api/aster-withdraw',
  '/aster-session',
  '/api/aster-signed/fapi/v3/order',
  '/aster-creds',                              // gone today; listed so a revival can't slip out
  '/api/aster-withdraw?chainId=56',
]) {
  assert.equal(isSecretBodyPath(p), true, `${p} must be body-suppressed`);
}
for (const p of ['/health', '/api/aster-fapi/fapi/v1/ticker', '/api/news', undefined]) {
  assert.equal(isSecretBodyPath(p), false, `${p} must not be body-suppressed`);
}

console.log('scrub.test.ts OK');
