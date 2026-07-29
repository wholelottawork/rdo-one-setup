// Run: npm test   (node strips the types natively, no test framework)
import assert from 'node:assert/strict';
import { Wallet, verifyMessage } from 'ethers';
import { authMessage } from './wallet-auth.ts';

// The exact bytes the frontend must produce. frontend/app/transfer/page.tsx has
// its own copy of this builder — if either side drifts, every withdrawal starts
// failing with "Signature does not match", so pin the format here.
const EXPECTED = [
  'RDO ONE authorization',
  'action: aster-withdraw',
  'user: 0xabc0000000000000000000000000000000000001',
  'params: address=0xdead000000000000000000000000000000000000&amount=25&asset=USDT',
  'timestamp: 1700000000000',
].join('\n');

assert.equal(
  authMessage(
    'aster-withdraw',
    '0xAbC0000000000000000000000000000000000001',
    { asset: 'USDT', amount: '25', address: '0xdead000000000000000000000000000000000000' },
    1700000000000,
  ),
  EXPECTED,
  'message format must be stable and address-case-insensitive',
);

// Param order in the object must not change the signed bytes — the frontend
// builds these literals by hand and won't always match declaration order.
assert.equal(
  authMessage('aster-withdraw', '0xabc0000000000000000000000000000000000001',
    { address: '0xdead000000000000000000000000000000000000', amount: '25', asset: 'USDT' }, 1700000000000),
  EXPECTED,
  'params are sorted, so key order is irrelevant',
);

const wallet = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');

// Round trip: what we sign is what verifies back to the signer.
const msg = authMessage('aster-withdraw', wallet.address, { asset: 'USDT', amount: '25', address: '0xdead000000000000000000000000000000000000' }, 1700000000000);
const sig = await wallet.signMessage(msg);
assert.equal(verifyMessage(msg, sig).toLowerCase(), wallet.address.toLowerCase(), 'signature recovers the signer');

// The whole point: a signature is bound to ITS parameters. Swapping the
// destination address must not verify against the original signature.
const tampered = authMessage('aster-withdraw', wallet.address, { asset: 'USDT', amount: '25', address: '0xbad0000000000000000000000000000000000000' }, 1700000000000);
assert.notEqual(verifyMessage(tampered, sig).toLowerCase(), wallet.address.toLowerCase(), 'changing the destination must break the signature');

// Same for the amount, and for the action itself.
const biggerAmount = authMessage('aster-withdraw', wallet.address, { asset: 'USDT', amount: '2500', address: '0xdead000000000000000000000000000000000000' }, 1700000000000);
assert.notEqual(verifyMessage(biggerAmount, sig).toLowerCase(), wallet.address.toLowerCase(), 'changing the amount must break the signature');
const otherAction = authMessage('aster-creds-delete', wallet.address, { asset: 'USDT', amount: '25', address: '0xdead000000000000000000000000000000000000' }, 1700000000000);
assert.notEqual(verifyMessage(otherAction, sig).toLowerCase(), wallet.address.toLowerCase(), 'a signature for one action must not authorize another');

console.log('wallet-auth: all checks passed');
