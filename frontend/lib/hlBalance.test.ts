// Run: npm test   (node strips the types natively, no test framework)
import assert from 'node:assert/strict';
import {
  HL_WITHDRAW_FEE,
  hlArrivingUnits,
  hlErrorMessage,
  isUnifiedAccount,
  isUnifiedAccountError,
  parseHLBalances,
} from './hlBalance.ts';

// The case that started this: everything in spot, nothing on the perp side.
// The exchange shows 9.94 and reading only the perp side told the user they
// had no funds, leaving MAX doing nothing.
{
  const ch = {
    marginSummary: { accountValue: '0.0', totalNtlPos: '0.0', totalMarginUsed: '0.0' },
    crossMarginSummary: { accountValue: '0.0', totalMarginUsed: '0.0' },
    withdrawable: '0.0',
  };
  const spot = { balances: [{ coin: 'USDC', token: 0, hold: '0.0', total: '9.94', entryNtl: '0.0' }] };

  // Standard account: the 9.94 is withdrawable, but only after a spot→perp
  // class transfer.
  const std = parseHLBalances(ch, spot);
  assert.equal(std.ready, 0);
  assert.equal(std.needsMove, 9.94);
  assert.equal(std.total, 9.94);
  assert.equal(std.unified, false);

  // Unified account: same 9.94, but it withdraws as-is. Hyperliquid rejects the
  // class transfer outright there ("Action disabled when unified account is
  // active"), so nothing may be scheduled to move.
  const uni = parseHLBalances(ch, spot, true);
  assert.equal(uni.ready, 9.94);
  assert.equal(uni.needsMove, 0);
  assert.equal(uni.total, 9.94);
  assert.equal(uni.unified, true);
}

// On a unified account the spot figure covers spot AND perps, so adding the
// perp side on top would double-count it and hand MAX an amount the
// withdrawal is then rejected for.
{
  const ch = { withdrawable: '40.0', marginSummary: { accountValue: '40', totalMarginUsed: '0' } };
  const spot = { balances: [{ coin: 'USDC', total: '40.0', hold: '0.0' }] };
  assert.equal(parseHLBalances(ch, spot, true).total, 40);
  assert.equal(parseHLBalances(ch, spot, false).total, 80);
}

// ── Account mode ──────────────────────────────────────────────────────────
// `userAbstraction` answers with a bare string. Only "default" is a standard
// account; every other mode keeps its balance in spot and refuses transfers,
// so an unrecognised one must NOT be read as standard.
assert.equal(isUnifiedAccount('default'), false);
assert.equal(isUnifiedAccount('  Default  '), false);
// The value a unified account actually answers with, confirmed against the
// live endpoint ("default") and reports from other API clients.
assert.equal(isUnifiedAccount('unifiedAccount'), true);
assert.equal(isUnifiedAccount('unified'), true);
assert.equal(isUnifiedAccount('portfolioMargin'), true);
assert.equal(isUnifiedAccount('somethingNew'), true);
// An object form must not stringify to "[object Object]" and read as unified.
assert.equal(isUnifiedAccount({ type: 'default' }), false);
assert.equal(isUnifiedAccount({ type: 'unified' }), true);
// A failed read falls back to standard: that path still completes on a unified
// account, because the class transfer it attempts is caught and skipped.
assert.equal(isUnifiedAccount(null), false);
assert.equal(isUnifiedAccount(undefined), false);
assert.equal(isUnifiedAccount(''), false);
assert.equal(isUnifiedAccount(42), false);

// ── Error surfacing ───────────────────────────────────────────────────────
// The failure that prompted all this arrived as a bare string under
// `response`, and reaching only for `response.data.message` printed the whole
// JSON envelope at the user instead of the one sentence explaining it.
{
  const envelope = { status: 'err', response: 'Action disabled when unified account is active' };
  assert.equal(hlErrorMessage(envelope), 'Action disabled when unified account is active');
  assert.ok(isUnifiedAccountError(hlErrorMessage(envelope)));
}
assert.equal(hlErrorMessage({ response: { data: { message: 'Insufficient balance' } } }), 'Insufficient balance');
assert.equal(hlErrorMessage({ error: 'nonce too low' }), 'nonce too low');
// Nothing recognisable still yields something printable rather than "undefined".
assert.ok(hlErrorMessage({ weird: true }).length > 0);
assert.ok(hlErrorMessage(null).length > 0);
// Unrelated failures must not be mistaken for the unified case, which is
// swallowed on purpose.
assert.equal(isUnifiedAccountError('Insufficient balance for withdrawal'), false);
assert.equal(isUnifiedAccountError('User or API Wallet does not exist'), false);

// Funds on the perp side: `withdrawable` is the answer, NOT accountValue —
// accountValue counts margin locked by open positions, which cannot leave.
{
  const ch = {
    marginSummary: { accountValue: '120.0', totalMarginUsed: '80.0' },
    withdrawable: '40.0',
  };
  const b = parseHLBalances(ch, { balances: [] });
  assert.equal(b.ready, 40);
  assert.equal(b.needsMove, 0);
  assert.equal(b.total, 40);
}

// Both halves fund a withdrawal, so both count toward MAX.
{
  const b = parseHLBalances(
    { withdrawable: '3.5', marginSummary: { accountValue: '3.5', totalMarginUsed: '0' } },
    { balances: [{ coin: 'USDC', total: '6.5', hold: '0.0' }] },
  );
  assert.equal(b.ready, 3.5);
  assert.equal(b.needsMove, 6.5);
  assert.equal(b.total, 10);
}

// Spot USDC reserved as margin (hold) is not movable — offering it as MAX
// produces a withdrawal Hyperliquid refuses.
{
  const b = parseHLBalances({ withdrawable: '0' }, { balances: [{ coin: 'USDC', total: '10', hold: '7.5' }] });
  assert.equal(b.needsMove, 2.5);
}

// Other spot tokens are not collateral and must not inflate the total.
{
  const b = parseHLBalances({ withdrawable: '0' }, { balances: [
    { coin: 'HYPE', total: '1000', hold: '0' },
    { coin: 'PURR', total: '5000', hold: '0' },
  ] });
  assert.equal(b.needsMove, 0);
  assert.equal(b.total, 0);
}

// Older/odd payloads: no `withdrawable` field at all falls back to equity less
// margin in use, and an isolated-margin account (all-zero crossMarginSummary)
// still reads its account-wide marginSummary.
{
  const b = parseHLBalances(
    { marginSummary: { accountValue: '25', totalMarginUsed: '10' }, crossMarginSummary: { accountValue: '0.0', totalMarginUsed: '0.0' } },
    {},
  );
  assert.equal(b.ready, 15);
}

// Nothing at all, and junk, read as zero rather than NaN — a NaN balance
// renders as "$NaN" and makes every comparison in the withdrawal path false.
{
  for (const [ch, spot] of [[null, null], [{}, {}], [{ withdrawable: 'abc' }, { balances: 'nope' }]] as any[][]) {
    const b = parseHLBalances(ch, spot);
    assert.equal(b.total, 0);
    assert.ok(Number.isFinite(b.ready) && Number.isFinite(b.needsMove));
  }
}

// Negative withdrawable (an account under water) must not subtract from spot.
{
  const b = parseHLBalances({ withdrawable: '-5' }, { balances: [{ coin: 'USDC', total: '10', hold: '0' }] });
  assert.equal(b.ready, 0);
  assert.equal(b.total, 10);
}

// ── What actually lands in the wallet ─────────────────────────────────────
// The fee comes out of the withdrawal, so the poll has to expect the NET
// amount. On a 9.94 withdrawal the old 97%-of-gross target (9.64) is more than
// the 8.94 that arrives, and the step timed out on a completed withdrawal.
{
  const arriving = hlArrivingUnits(9.94);
  const net = BigInt(Math.round((9.94 - HL_WITHDRAW_FEE) * 1e6));
  assert.ok(arriving <= net, 'target must not exceed what arrives');
  assert.ok(arriving > (net * BigInt(98)) / BigInt(100), 'target must not be so low it matches a partial arrival');
  assert.ok(arriving < BigInt(Math.round(9.94 * 1e6 * 0.97)), 'must be below the old gross-based target');
}

// A withdrawal at or under the fee leaves nothing to wait for.
{
  assert.equal(hlArrivingUnits(1), BigInt(0));
  assert.equal(hlArrivingUnits(0), BigInt(0));
}

// Large withdrawals keep the same net-of-fee rule.
{
  assert.ok(hlArrivingUnits(1000) <= BigInt(Math.round(999 * 1e6)));
  assert.ok(hlArrivingUnits(1000) > BigInt(Math.round(989 * 1e6)));
}

console.log('hlBalance: all checks passed');
