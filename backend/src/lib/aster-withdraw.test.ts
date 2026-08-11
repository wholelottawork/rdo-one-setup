// Run: npm test   (tsx, no test framework)
import assert from 'node:assert/strict';
import { TypedDataEncoder, Wallet } from 'ethers';
import {
  ASTER_AUTH_TYPES,
  ASTER_CHAIN_SHORT_NAME,
  ASTER_WITHDRAW_ACTION_TYPES,
  asterAuthDomain,
  asterWithdrawActionDomain,
  buildAsterWithdrawAction,
  normalizeAsterAmount,
  toPlainDecimal,
  asterWithdrawParams,
  verifyAsterWithdrawAuthorization,
} from './aster-withdraw.ts';

// ── The signature format itself ───────────────────────────────────────────
// Pinned the way frontend/lib/authMessage.test.ts pins the auth message, and
// for the same reason: a withdrawal signature that drifts is unrecoverable —
// Aster answers "Signature check failed" and nothing else. The mirror of this
// block lives in frontend/lib/asterWithdraw.test.ts; change one, change both.

// Note the two field names containing a SPACE. They are real.
assert.equal(
  TypedDataEncoder.from(ASTER_WITHDRAW_ACTION_TYPES).encodeType('Action'),
  'Action(string type,address destination,string destination Chain,string token,'
  + 'string amount,string fee,uint256 nonce,string aster chain)',
);

// Field ORDER is part of the type hash, so assert it literally too.
assert.deepEqual(
  ASTER_WITHDRAW_ACTION_TYPES.Action.map((f) => `${f.name}:${f.type}`),
  [
    'type:string',
    'destination:address',
    'destination Chain:string',
    'token:string',
    'amount:string',
    'fee:string',
    'nonce:uint256',
    'aster chain:string',
  ],
);

// The two domains are NOT the same and must never be shared by accident:
// chainId 1666 authenticates the request, the destination chain authorizes
// the funds.
assert.deepEqual(asterAuthDomain(), {
  name: 'AsterSignTransaction',
  version: '1',
  chainId: 1666,
  verifyingContract: '0x0000000000000000000000000000000000000000',
});
assert.deepEqual(asterWithdrawActionDomain(42161), {
  name: 'Aster',
  version: '1',
  chainId: 42161,
  verifyingContract: '0x0000000000000000000000000000000000000000',
});
assert.deepEqual(ASTER_AUTH_TYPES, { Message: [{ name: 'msg', type: 'string' }] });

const RECEIVER = '0x851d000000000000000000000000000000000a73';
const ACTION = buildAsterWithdrawAction({
  chainId: '42161', receiver: RECEIVER, asset: 'USDT',
  amount: '1.23', fee: '0.51', userNonce: '1786143846408000',
});
assert.deepEqual(ACTION, {
  type: 'Withdraw',
  destination: RECEIVER,
  'destination Chain': 'Arbitrum',
  token: 'USDT',
  amount: '1.23',
  fee: '0.51',
  nonce: '1786143846408000',
  'aster chain': 'Mainnet',
});
// Whole-payload digest — catches any change the field-by-field asserts miss.
assert.equal(
  TypedDataEncoder.hash(asterWithdrawActionDomain(42161), ASTER_WITHDRAW_ACTION_TYPES, ACTION),
  '0x501b5af5abb27610fc1551c5f215f7706d57b56bfa0bdd36f0cc74d045d816ec',
);

// chainId 56 is "BSC", not "BNB Chain" — Aster's own UI shows the latter and
// signing it fails.
assert.equal(ASTER_CHAIN_SHORT_NAME['56'], 'BSC');
assert.equal(ASTER_CHAIN_SHORT_NAME['1'], 'ETH');
assert.equal(ASTER_CHAIN_SHORT_NAME['42161'], 'Arbitrum');
assert.throws(() => buildAsterWithdrawAction({
  chainId: '999999', receiver: RECEIVER, asset: 'USDT', amount: '1', fee: '0', userNonce: '1',
}), /Unsupported/);

// ── Number formatting ─────────────────────────────────────────────────────
// Aster's fee endpoint returns 1.7E-4 for BNB on BSC; the signed value is
// "0.00017".
assert.equal(toPlainDecimal(1.7e-4), '0.00017');
assert.equal(toPlainDecimal(2.7e-4), '0.00027');
assert.equal(toPlainDecimal(1e-7), '0.0000001');
assert.equal(toPlainDecimal(0.51), '0.51');
assert.equal(toPlainDecimal('0.51'), '0.51');
assert.equal(toPlainDecimal(25), '25');
assert.equal(toPlainDecimal(1.5e21), '1500000000000000000000');
assert.equal(normalizeAsterAmount('.5'), '0.5');
assert.equal(normalizeAsterAmount('0.5'), '0.5');


// ── Authorization verification ────────────────────────────────────────────
// The browser now sends ONE signature: the Action. The V3 auth wrapper is
// signed by the user's own server-held agent key at forwarding time, so it is
// no longer something this module can or should check.
//
// That makes the Action check the ONLY thing standing between this endpoint
// and an open relay, and the only reason the agent key is not a hot wallet —
// Aster rejects an agent-signed Action, so a user's own signature over
// destination/amount/fee is the sole authorization to move funds.
const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const attacker = new Wallet(`0x${'22'.repeat(32)}`);

async function makeBody(over: Record<string, string> = {}, actionSigner = wallet) {
  const base = {
    chainId: '42161', asset: 'USDT', amount: '1.23', fee: '0.51',
    receiver: RECEIVER, userNonce: String(Date.now() * 1000), ...over,
  };
  const userSignature = await actionSigner.signTypedData(
    asterWithdrawActionDomain(Number(base.chainId)),
    ASTER_WITHDRAW_ACTION_TYPES,
    buildAsterWithdrawAction(base as Parameters<typeof buildAsterWithdrawAction>[0]),
  );
  return { ...base, userSignature };
}

// Happy path, and `user` comes from the session rather than the body.
{
  const body = await makeBody();
  const res = verifyAsterWithdrawAuthorization(body, wallet.address);
  assert.equal(res.ok, true, res.ok ? '' : res.msg);
  assert.equal(res.ok && res.fields.user, wallet.address);
}

// Someone else's signature presented under our session — the whole point of
// recovering it rather than trusting the body.
{
  const body = await makeBody({}, attacker);
  const res = verifyAsterWithdrawAuthorization(body, wallet.address);
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.status, 403);
}

// A `user` in the body must NOT redirect which account is used — the session
// address wins and the body's is ignored outright.
{
  const body = { ...(await makeBody()), user: attacker.address };
  const res = verifyAsterWithdrawAuthorization(body, wallet.address);
  assert.equal(res.ok, true, 'body `user` is ignored, not trusted');
  assert.equal(res.ok && res.fields.user, wallet.address);
}

// The signature must cover the destination/amount/fee actually forwarded:
// rewriting any of them after signing has to fail.
for (const [k, v] of [
  ['receiver', '0xdead000000000000000000000000000000000000'],
  ['amount', '999'],
  ['fee', '0'],
  ['chainId', '56'],
] as const) {
  const body = { ...(await makeBody()), [k]: v };
  const res = verifyAsterWithdrawAuthorization(body, wallet.address);
  assert.equal(res.ok, false, `tampering with ${k} must be rejected`);
}

// No session, no withdrawal — even with a perfectly good signature.
{
  const body = await makeBody();
  const res = verifyAsterWithdrawAuthorization(body, '');
  assert.equal(res.ok === false && res.status, 401);
}

// Fail closed on a missing fee rather than forwarding a guessed one.
{
  const { fee, ...body } = await makeBody();
  void fee;
  const res = verifyAsterWithdrawAuthorization(body, wallet.address);
  assert.equal(res.ok === false && res.status, 400);
}

// A stale userNonce is rejected here rather than at Aster, where discovering
// it costs the user a wallet round trip.
{
  const body = await makeBody({ userNonce: '1' });
  const res = verifyAsterWithdrawAuthorization(body, wallet.address);
  assert.equal(res.ok === false && res.status, 400);
}

// A chain Aster cannot pay out on is refused, not forwarded.
{
  const body = await makeBody();
  const res = verifyAsterWithdrawAuthorization({ ...body, chainId: '999999' }, wallet.address);
  assert.equal(res.ok === false && res.status, 400);
}

// ── What goes on the wire ─────────────────────────────────────────────────
// signer/nonce/signature are appended by signAsterV3RequestAs, never here —
// one place decides what an agent-signed V3 request looks like.
{
  const body = await makeBody();
  const res = verifyAsterWithdrawAuthorization(body, wallet.address);
  assert.equal(res.ok, true);
  const params = res.ok ? asterWithdrawParams(res.fields) : {};
  assert.equal(params.signatureType, 'EOA');
  assert.equal(params.user, wallet.address);
  assert.equal(params.userSignature, body.userSignature);
  for (const k of ['signer', 'nonce', 'signature']) assert.ok(!(k in params), `${k} must not be set here`);
}

console.log('aster-withdraw: all checks passed');
