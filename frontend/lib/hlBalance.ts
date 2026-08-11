/**
 * What Hyperliquid will let a page move, read out of its two account halves.
 *
 * A Hyperliquid account is not one balance. `clearinghouseState` describes the
 * PERP side and `spotClearinghouseState` the SPOT side, and on a unified
 * account the USDC sits in spot until a position needs it as margin — so an
 * account showing 9.94 on the exchange reports `marginSummary.accountValue`
 * of 0. Reading only the perp half told users with funds that they had none.
 *
 * `withdraw3` pays out of the perp balance alone, which is why the two halves
 * stay separate here: the perp part can leave immediately, the spot part needs
 * a `usdClassTransfer` into perps first.
 */
export interface HLBalances {
  /** USDC that can leave the perp account right now, net of margin in use. */
  perpAvail: number;
  /** Free spot USDC (total less what is held), movable into perps. */
  spotUsdc: number;
  /** Everything the account can move: perpAvail + spotUsdc. */
  total: number;
}

/** Hyperliquid's flat withdrawal fee, taken out of the amount withdrawn. */
export const HL_WITHDRAW_FEE = 1;
/** Below this Hyperliquid rejects the withdrawal outright. */
export const HL_MIN_WITHDRAW = 2;

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

export function parseHLBalances(clearinghouse: any, spot: any): HLBalances {
  const ch = clearinghouse ?? {};
  // marginSummary is the account-wide total (cross + isolated);
  // crossMarginSummary is all-zeros for isolated-margin accounts.
  const ms = ch.marginSummary || ch.crossMarginSummary || {};
  // `withdrawable` is Hyperliquid's own answer to "what can leave the perp
  // account", already net of margin held by open positions. accountValue is
  // not that number — it counts margin that cannot be withdrawn — so it is
  // only the fallback, and even then minus the margin in use.
  const perpAvail = ch.withdrawable != null
    ? Math.max(0, num(ch.withdrawable))
    : Math.max(0, num(ms.accountValue) - num(ms.totalMarginUsed));

  // USDC only: it is the sole collateral a withdrawal pays out, so spot HYPE
  // or PURR is not part of what can be moved this way.
  const balances: any[] = Array.isArray(spot?.balances) ? spot.balances : [];
  const usdc = balances.find(b => b?.coin === 'USDC');
  const spotUsdc = usdc ? Math.max(0, num(usdc.total) - num(usdc.hold)) : 0;

  return { perpAvail, spotUsdc, total: perpAvail + spotUsdc };
}

/**
 * What a withdrawal of `amt` actually puts in the wallet, in USDC units (6
 * decimals), with 1% of slack for the poll that waits on it.
 *
 * The old target was 97% of the GROSS amount, which only exceeds the net one
 * above ~33 USDC — under that, the "wait for it to arrive" step timed out on a
 * withdrawal that had already landed.
 */
export function hlArrivingUnits(amt: number): bigint {
  const net = Math.max(0, amt - HL_WITHDRAW_FEE);
  return BigInt(Math.max(0, Math.round(net * 1e6 * 0.99)));
}
