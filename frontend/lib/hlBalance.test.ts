// Run: npm test   (node strips the types natively, no test framework)
import assert from 'node:assert/strict';
import { HL_WITHDRAW_FEE, hlArrivingUnits, parseHLBalances } from './hlBalance.ts';

// The case that started this: a unified account with everything in spot. The
// exchange shows 9.94, the perp side reports nothing, and reading only the
// perp side told the user they had no funds and left MAX doing nothing.
{
  const ch = {
    marginSummary: { accountValue: '0.0', totalNtlPos: '0.0', totalMarginUsed: '0.0' },
    crossMarginSummary: { accountValue: '0.0', totalMarginUsed: '0.0' },
    withdrawable: '0.0',
  };
  const spot = { balances: [{ coin: 'USDC', token: 0, hold: '0.0', total: '9.94', entryNtl: '0.0' }] };
  const b = parseHLBalances(ch, spot);
  assert.equal(b.perpAvail, 0);
  assert.equal(b.spotUsdc, 9.94);
  assert.equal(b.total, 9.94);
}

// Funds on the perp side: `withdrawable` is the answer, NOT accountValue —
// accountValue counts margin locked by open positions, which cannot leave.
{
  const ch = {
    marginSummary: { accountValue: '120.0', totalMarginUsed: '80.0' },
    withdrawable: '40.0',
  };
  const b = parseHLBalances(ch, { balances: [] });
  assert.equal(b.perpAvail, 40);
  assert.equal(b.spotUsdc, 0);
  assert.equal(b.total, 40);
}

// Both halves fund a withdrawal, so both count toward MAX.
{
  const b = parseHLBalances(
    { withdrawable: '3.5', marginSummary: { accountValue: '3.5', totalMarginUsed: '0' } },
    { balances: [{ coin: 'USDC', total: '6.5', hold: '0.0' }] },
  );
  assert.equal(b.perpAvail, 3.5);
  assert.equal(b.spotUsdc, 6.5);
  assert.equal(b.total, 10);
}

// Spot USDC reserved as margin (hold) is not movable — offering it as MAX
// produces a withdrawal Hyperliquid refuses.
{
  const b = parseHLBalances({ withdrawable: '0' }, { balances: [{ coin: 'USDC', total: '10', hold: '7.5' }] });
  assert.equal(b.spotUsdc, 2.5);
}

// Other spot tokens are not collateral and must not inflate the total.
{
  const b = parseHLBalances({ withdrawable: '0' }, { balances: [
    { coin: 'HYPE', total: '1000', hold: '0' },
    { coin: 'PURR', total: '5000', hold: '0' },
  ] });
  assert.equal(b.spotUsdc, 0);
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
  assert.equal(b.perpAvail, 15);
}

// Nothing at all, and junk, read as zero rather than NaN — a NaN balance
// renders as "$NaN" and makes every comparison in the withdrawal path false.
{
  for (const [ch, spot] of [[null, null], [{}, {}], [{ withdrawable: 'abc' }, { balances: 'nope' }]] as any[][]) {
    const b = parseHLBalances(ch, spot);
    assert.equal(b.total, 0);
    assert.ok(Number.isFinite(b.perpAvail) && Number.isFinite(b.spotUsdc));
  }
}

// Negative withdrawable (an account under water) must not subtract from spot.
{
  const b = parseHLBalances({ withdrawable: '-5' }, { balances: [{ coin: 'USDC', total: '10', hold: '0' }] });
  assert.equal(b.perpAvail, 0);
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
