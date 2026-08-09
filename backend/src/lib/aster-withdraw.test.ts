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
  verifyAsterWithdrawRequest,
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

// ── Request verification ──────────────────────────────────────────────────
const wallet = new Wallet(`0x${'11'.repeat(32)}`);
const attacker = new Wallet(`0x${'22'.repeat(32)}`);

async function makeRequest(over: Record<string, string> = {}, actionSigner = wallet, authSigner = wallet) {
  const userNonce = String(Date.now() * 1000);
  const base = {
    chainId: '42161', asset: 'USDT', amount: '1.23', fee: '0.51',
    receiver: RECEIVER, userNonce, ...over,
  };
  const userSignature = await actionSigner.signTypedData(
    asterWithdrawActionDomain(Number(base.chainId)),
    ASTER_WITHDRAW_ACTION_TYPES,
    buildAsterWithdrawAction(base as Parameters<typeof buildAsterWithdrawAction>[0]),
  );
  const query = new URLSearchParams({
    ...base,
    userSignature,
    signatureType: 'EOA',
    user: wallet.address,
    nonce: String(Date.now() * 1000),
  }).toString();
  const signature = await authSigner.signTypedData(asterAuthDomain(), ASTER_AUTH_TYPES, { msg: query });
  return { query, signature };
}

{
  const { query, signature } = await makeRequest();
  const res = verifyAsterWithdrawRequest(query, signature);
  assert.equal(res.ok, true, res.ok ? '' : res.msg);
  assert.equal(res.ok && res.fields.user.toLowerCase(), wallet.address.toLowerCase());
}

// Someone else's auth signature over our query — the classic "user is a
// public address" attack.
{
  const { query, signature } = await makeRequest({}, wallet, attacker);
  const res = verifyAsterWithdrawRequest(query, signature);
  assert.equal(res.ok, false);
  assert.equal(res.ok === false && res.status, 403);
}

// The Action signature must cover the destination/amount/fee actually sent:
// rewriting any of them after signing has to fail.
for (const [k, v] of [['receiver', '0xdead000000000000000000000000000000000000'], ['amount', '999'], ['fee', '0']] as const) {
  const { query, signature } = await makeRequest();
  const p = new URLSearchParams(query);
  p.set(k, v);
  const tampered = p.toString();
  // Re-sign the wrapper so the tamper is tested against the ACTION check,
  // not caught earlier by the wrapper's own signature.
  const resigned = await wallet.signTypedData(asterAuthDomain(), ASTER_AUTH_TYPES, { msg: tampered });
  const res = verifyAsterWithdrawRequest(tampered, resigned);
  assert.equal(res.ok, false, `tampering with ${k} must be rejected`);
  assert.equal(res.ok === false && res.status, 403);
  void signature;
}

// A withdrawal is never agent-signed — Aster rejects an agent without
// canWithdraw at the permission check, and we do not mint agents that have it.
{
  const { query, signature } = await makeRequest();
  const withSigner = `${query}&signer=${wallet.address}`;
  const res = verifyAsterWithdrawRequest(withSigner, signature);
  assert.equal(res.ok === false && res.status, 400);
}

// `signature` goes on last, appended by the route — never inside the signed
// string.
{
  const { query, signature } = await makeRequest();
  const res = verifyAsterWithdrawRequest(`${query}&signature=0xdead`, signature);
  assert.equal(res.ok === false && res.status, 400);
}

// Fail closed on a missing fee rather than sending a guessed one.
{
  const { query, signature } = await makeRequest();
  const p = new URLSearchParams(query);
  p.delete('fee');
  const res = verifyAsterWithdrawRequest(p.toString(), signature);
  assert.equal(res.ok === false && res.status, 400);
}

console.log('aster-withdraw: all checks passed');
