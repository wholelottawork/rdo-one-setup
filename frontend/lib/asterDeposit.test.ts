// Run: npm test   (node strips the types natively, no test framework)
import assert from 'node:assert/strict';
import {
  ASTER_BROKER,
  ASTER_DEPOSIT_CHAIN,
  ASTER_NATIVE_CURRENCY,
  ASTER_SPOT_BROKER,
  ASTER_VAULTS,
  DEPOSIT_FOR_SELECTOR,
  asterVault,
  encodeDepositFor,
} from './asterDeposit.ts';

// This pins the exact bytes handed to eth_sendTransaction. A deposit is a raw
// contract call with no server round-trip to sanity-check it, and the failure
// mode of the last argument is silent: the transaction succeeds, the money
// lands in an account this app cannot read, and nothing reports an error.

const USER  = '0x851d000000000000000000000000000000000a73';
const USDT_ARB = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';

// ── Selector ──────────────────────────────────────────────────────────────
// keccak256('depositFor(address,address,uint256,uint256)') — the four-byte
// prefix of every call below. Wrong here and the vault falls through to its
// fallback function.
assert.equal(DEPOSIT_FOR_SELECTOR, '0xcf4a0c5e');

// ── ERC-20 deposit ────────────────────────────────────────────────────────
const erc20 = encodeDepositFor({ token: USDT_ARB, forAddress: USER, amount: '1230000' });

assert.equal(
  erc20,
  '0xcf4a0c5e'
  + '000000000000000000000000fd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9' // currency = USDT
  + '000000000000000000000000851d000000000000000000000000000000000a73' // forAddress
  + '000000000000000000000000000000000000000000000000000000000012c4b0' // amount = 1_230_000
  + '0000000000000000000000000000000000000000000000000000000000000000', // broker = 0 -> FUTURES
);

// Selector plus four 32-byte words, nothing more.
assert.equal(erc20.length, 2 + 8 + 4 * 64);

// ── The broker argument ───────────────────────────────────────────────────
// The default MUST NOT be 1000: that is the spot account.
assert.notEqual(ASTER_BROKER, ASTER_SPOT_BROKER);
assert.equal(ASTER_BROKER, BigInt(0));

// The last word is the broker, and it is the only difference between crediting
// futures and crediting spot.
const spot = encodeDepositFor({ token: USDT_ARB, forAddress: USER, amount: '1230000', broker: ASTER_SPOT_BROKER });
assert.equal(spot.slice(-64), BigInt(1000).toString(16).padStart(64, '0'));
assert.equal(spot.slice(0, -64), erc20.slice(0, -64));

// ── Native deposit ────────────────────────────────────────────────────────
// The zero address is how the token pickers spell a native token; it must be
// rewritten to Aster's placeholder, never passed through as 0x0.
for (const nativeToken of ['0x0000000000000000000000000000000000000000', '']) {
  const native = encodeDepositFor({ token: nativeToken, forAddress: USER, amount: BigInt(10) ** BigInt(18) });
  assert.equal(native.slice(10, 74), ASTER_NATIVE_CURRENCY.slice(2).toLowerCase().padStart(64, '0'));
  assert.equal(native.slice(138, 202), (BigInt(10) ** BigInt(18)).toString(16).padStart(64, '0'));
}

// ── Vault lookup ──────────────────────────────────────────────────────────
assert.equal(asterVault('42161'), '0x9E36CB86a159d479cEd94Fa05036f235Ac40E1d5');
assert.equal(asterVault('1'),     '0x604DD02d620633Ae427888d41bfd15e38483736E');
assert.equal(asterVault('56'),    '0x128463A60784c4D3f46c23Af3f65Ed859Ba87974');
// The deposit chain must actually have a vault — the whole flow converts to it.
assert.ok(ASTER_VAULTS[ASTER_DEPOSIT_CHAIN]);
// An unsupported chain must throw rather than encode a call to `undefined`.
assert.throws(() => asterVault('8453'), /no deposit vault on chain 8453/);

console.log('asterDeposit: all checks passed');
