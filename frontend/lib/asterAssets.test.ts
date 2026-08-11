// Run: npm test   (node strips the types natively, no test framework)
import assert from 'node:assert/strict';
import {
  ASTER_PAYOUT_TOKENS,
  ASTER_UNMAPPED_ASSETS,
  ASTER_WITHDRAW_ASSETS,
  NATIVE_TOKEN,
  asterDisplayDecimals,
  asterMaxAmount,
  asterPayoutToken,
  asterWithdrawChains,
  isAsterWithdrawAsset,
} from './asterAssets.ts';

// Everything here exists because the transfer page used to assume one asset on
// one chain, and every assumption it baked in is false for some other pairing.
// These are the assumptions, pinned.

// ── Decimals are per (asset, chain), never per symbol ──────────────────────
// The one that silently breaks a withdrawal: a flat 1e6 waits for 10^12 times
// the real amount on BNB Chain, so the arrival poll times out and the
// conversion leg never runs on funds that DID arrive.
assert.equal(asterPayoutToken('USDT', '1')!.decimals, 6);
assert.equal(asterPayoutToken('USDT', '42161')!.decimals, 6);
assert.equal(asterPayoutToken('USDT', '56')!.decimals, 18, 'USDT is 18 decimals on BNB Chain');
assert.equal(asterPayoutToken('USDC', '56')!.decimals, 18, 'USDC is 18 decimals on BNB Chain');
assert.equal(asterPayoutToken('USDC', '42161')!.decimals, 6);

// ── Native is not an ERC-20 ────────────────────────────────────────────────
// balanceOf against the zero address answers '0x', which is not a zero balance.
assert.equal(asterPayoutToken('BNB', '56')!.native, true);
assert.equal(asterPayoutToken('BNB', '56')!.address, NATIVE_TOKEN);
assert.equal(asterPayoutToken('ETH', '1')!.native, true);
assert.equal(asterPayoutToken('ETH', '42161')!.native, true);
// ...but ETH on BNB Chain is an ordinary token, not the gas token.
assert.equal(asterPayoutToken('ETH', '56')!.native, false);
assert.notEqual(asterPayoutToken('ETH', '56')!.address, NATIVE_TOKEN);

// ── Payout chains are per asset ────────────────────────────────────────────
// The old flat set meant a BNB withdrawal defaulted to Arbitrum, which Aster
// does not pay BNB out on at all.
assert.deepEqual(asterWithdrawChains('BNB'), ['56']);
assert.equal(asterPayoutToken('BNB', '42161'), null, 'Aster pays no BNB on Arbitrum');
assert.equal(asterPayoutToken('BNB', '1'), null);
assert.deepEqual(asterWithdrawChains('USDT').sort(), ['1', '42161', '56']);
assert.deepEqual(asterWithdrawChains('USDC').sort(), ['1', '42161', '56']);

// Unknown pairings answer null rather than a default — callers must stop.
assert.equal(asterPayoutToken('USDT', '8453'), null, 'Aster answers "Unsupport token" on Base');
assert.equal(asterPayoutToken('DOGE', '56'), null);
assert.equal(asterWithdrawChains('DOGE').length, 0);

// ── Every offered asset is actually mappable ───────────────────────────────
for (const asset of ASTER_WITHDRAW_ASSETS) {
  assert.ok(isAsterWithdrawAsset(asset), `${asset} is offered but has no payout map`);
  assert.ok(asterWithdrawChains(asset).length > 0, `${asset} is offered but pays out nowhere`);
}

// ...and every deliberately-excluded one is genuinely absent, so the two lists
// cannot drift into offering something with no token address behind it.
for (const asset of Object.keys(ASTER_UNMAPPED_ASSETS)) {
  assert.ok(!(asset in ASTER_PAYOUT_TOKENS), `${asset} is both excluded and mapped`);
  assert.ok(!ASTER_WITHDRAW_ASSETS.includes(asset), `${asset} is both excluded and offered`);
}

// ── MAX truncates, and never rounds up ─────────────────────────────────────
// A real withdrawable BNB balance of 0.019 rendered at two decimals is "0.02",
// which is MORE than the account holds; Aster rejects it as over the limit.
assert.equal(asterDisplayDecimals('BNB'), 6);
assert.equal(asterDisplayDecimals('ETH'), 6);
assert.equal(asterDisplayDecimals('USDT'), 2);
assert.equal(asterDisplayDecimals('USDC'), 2);

assert.equal(asterMaxAmount(0.019, 'BNB'), '0.019000');
assert.equal(asterMaxAmount(0.0199999, 'BNB'), '0.019999', 'truncated, not rounded to 0.020000');
assert.equal(asterMaxAmount(1.089, 'USDT'), '1.08', 'truncated, not rounded to 1.09');
assert.equal(asterMaxAmount(1.09, 'USDT'), '1.09');
assert.equal(asterMaxAmount(0, 'USDT'), '0.00');
// Never wider than the withdrawable balance, whatever the asset.
for (const [bal, asset] of [[12.079, 'USDT'], [0.0199, 'BNB'], [3.14159265, 'ETH']] as const)
  assert.ok(Number(asterMaxAmount(bal, asset)) <= bal, `MAX exceeds balance for ${asset}`);

console.log('asterAssets: all checks passed');
