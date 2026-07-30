// Run: npm test   (node strips the types natively, no test framework)
import assert from 'node:assert/strict';
import { authMessage } from './authMessage.ts';

// Byte-for-byte identical to the EXPECTED block in
// backend/src/lib/wallet-auth.test.ts. The frontend signs these bytes and the
// backend recovers the address from them — if the two files disagree by so
// much as a space, every withdrawal and every trading session fails with
// "Signature does not match the requested account". Change one, change both.
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
  'frontend message format must match the backend byte for byte',
);

// Key order must not change the bytes — these params are built by hand at
// each call site and won't always be declared in the same order.
assert.equal(
  authMessage('aster-withdraw', '0xabc0000000000000000000000000000000000001',
    { address: '0xdead000000000000000000000000000000000000', amount: '25', asset: 'USDT' }, 1700000000000),
  EXPECTED,
);

// The session signature is the no-params case — nothing to sort, but the
// blank `params:` line still has to be there.
assert.equal(
  authMessage('aster-session', '0xabc0000000000000000000000000000000000001', {}, 1700000000000),
  ['RDO ONE authorization', 'action: aster-session',
   'user: 0xabc0000000000000000000000000000000000001', 'params: ',
   'timestamp: 1700000000000'].join('\n'),
);

console.log('authMessage: all checks passed');
