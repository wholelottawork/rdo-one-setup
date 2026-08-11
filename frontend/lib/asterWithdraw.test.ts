// Run: npm test   (node strips the types natively, no test framework)
import assert from 'node:assert/strict';
import {
  ASTER_CHAIN_SHORT_NAME,
  ASTER_WITHDRAW_ACTION_FIELDS,
  buildAsterWithdrawTypedData,
  normalizeAsterAmount,
  toPlainDecimal,
} from './asterWithdraw.ts';

// This pins the exact bytes handed to eth_signTypedData_v4. It exists for the
// same reason authMessage.test.ts does: a signature format that drifts
// silently is unrecoverable — Aster answers "Signature check failed" and
// nothing else, and there is no parameter table anywhere that documents this
// struct. The counterpart assertions live in
// backend/src/lib/aster-withdraw.test.ts; change one, change both.

const RECEIVER = '0x851d000000000000000000000000000000000a73';
const USER = '0x851d000000000000000000000000000000000a73';

// ── Signature 2: the withdrawal authorization ─────────────────────────────
const td = buildAsterWithdrawTypedData({
  chainId: '42161', receiver: RECEIVER, asset: 'USDT',
  amount: '1.23', fee: '0.51', userNonce: '1786143846408000',
});

// Domain: name "Aster" on the DESTINATION chain — NOT AsterSignTransaction,
// and NOT 1666. Mixing this up with the auth domain below is the single most
// likely way to break withdrawals.
assert.deepEqual(td.domain, {
  name: 'Aster',
  version: '1',
  chainId: 42161,
  verifyingContract: '0x0000000000000000000000000000000000000000',
});
assert.equal(td.primaryType, 'Action');

// Field names AND their order — both are hashed into the signature.
// Note the SPACES in "destination Chain" and "aster chain". Real, not typos.
assert.deepEqual(
  ASTER_WITHDRAW_ACTION_FIELDS,
  [
    { name: 'type', type: 'string' },
    { name: 'destination', type: 'address' },
    { name: 'destination Chain', type: 'string' },
    { name: 'token', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'fee', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'aster chain', type: 'string' },
  ],
);
assert.ok(ASTER_WITHDRAW_ACTION_FIELDS.some((f) => f.name === 'destination Chain'), 'space in "destination Chain"');
assert.ok(ASTER_WITHDRAW_ACTION_FIELDS.some((f) => f.name === 'aster chain'), 'space in "aster chain"');

assert.deepEqual(td.message, {
  type: 'Withdraw',
  destination: RECEIVER,
  'destination Chain': 'Arbitrum',
  token: 'USDT',
  amount: '1.23',
  fee: '0.51',
  nonce: '1786143846408000',
  'aster chain': 'Mainnet',
});

// Whole payload, serialized exactly as it goes over eth_signTypedData_v4 —
// key order included, since that is what the wallet hashes.
assert.equal(
  JSON.stringify(td),
  '{"types":{"EIP712Domain":[{"name":"name","type":"string"},{"name":"version","type":"string"},'
  + '{"name":"chainId","type":"uint256"},{"name":"verifyingContract","type":"address"}],'
  + '"Action":[{"name":"type","type":"string"},{"name":"destination","type":"address"},'
  + '{"name":"destination Chain","type":"string"},{"name":"token","type":"string"},'
  + '{"name":"amount","type":"string"},{"name":"fee","type":"string"},'
  + '{"name":"nonce","type":"uint256"},{"name":"aster chain","type":"string"}]},'
  + '"primaryType":"Action","domain":{"name":"Aster","version":"1","chainId":42161,'
  + '"verifyingContract":"0x0000000000000000000000000000000000000000"},'
  + '"message":{"type":"Withdraw","destination":"0x851d000000000000000000000000000000000a73",'
  + '"destination Chain":"Arbitrum","token":"USDT","amount":"1.23","fee":"0.51",'
  + '"nonce":"1786143846408000","aster chain":"Mainnet"}}',
);

// chainId -> Aster's shortenName. 56 is "BSC"; Aster's own UI displays
// "BNB Chain", which does NOT verify.
assert.equal(ASTER_CHAIN_SHORT_NAME['56'], 'BSC');
assert.equal(ASTER_CHAIN_SHORT_NAME['1'], 'ETH');
assert.equal(ASTER_CHAIN_SHORT_NAME['42161'], 'Arbitrum');
assert.equal(
  buildAsterWithdrawTypedData({
    chainId: '56', receiver: RECEIVER, asset: 'BNB',
    amount: '0.001', fee: '0.00017', userNonce: '1786143846408000',
  }).message['destination Chain'],
  'BSC',
);
assert.throws(() => buildAsterWithdrawTypedData({
  chainId: '999999', receiver: RECEIVER, asset: 'USDT', amount: '1', fee: '0', userNonce: '1',
}), /does not support/);

// ── Number formatting ─────────────────────────────────────────────────────
assert.equal(toPlainDecimal(1.7e-4), '0.00017');   // Aster returns 1.7E-4 for BNB on BSC
assert.equal(toPlainDecimal(2.7e-4), '0.00027');
assert.equal(toPlainDecimal(1e-7), '0.0000001');
assert.equal(toPlainDecimal(0.51), '0.51');
assert.equal(toPlainDecimal('0.51'), '0.51');
assert.equal(toPlainDecimal(25), '25');
assert.equal(toPlainDecimal(1.5e21), '1500000000000000000000');
assert.equal(normalizeAsterAmount('.5'), '0.5');
assert.equal(normalizeAsterAmount('0.5'), '0.5');

console.log('asterWithdraw: all checks passed');
