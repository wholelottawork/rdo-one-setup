/**
 * What Hyperliquid will let a page move, read out of its two account halves.
 *
 * A Hyperliquid account is not one balance, and which half is authoritative
 * depends on the account's abstraction mode:
 *
 *  - STANDARD ("default"): `clearinghouseState` is the perp balance and
 *    `spotClearinghouseState` the spot one, and they are separate pools.
 *    `withdraw3` pays out of the PERP pool alone, so spot USDC has to be moved
 *    across with a `usdClassTransfer` before it can be withdrawn.
 *
 *  - UNIFIED (and portfolio margin): one balance per asset backs both spot and
 *    perps, and the spot clearinghouse state is the source of truth for the
 *    whole trading account. There is nothing to move — `usdClassTransfer` is
 *    rejected outright with "Action disabled when unified account is active" —
 *    and a withdrawal draws on that single balance directly.
 *
 * Reading only the perp half told unified-account users with funds that they
 * had none: their `marginSummary.accountValue` is 0 while the exchange shows
 * the balance sitting in spot.
 */
export interface HLBalances {
  /** USDC a withdrawal can pay out as-is, with no spot→perp transfer first. */
  ready: number;
  /**
   * USDC that needs a `usdClassTransfer` into perps before it can be
   * withdrawn. Always 0 on a unified account, where nothing needs moving.
   */
  needsMove: number;
  /** Everything the account can move: ready + needsMove. */
  total: number;
  /** Whether the account is in unified (or portfolio-margin) mode. */
  unified: boolean;
}

/** Hyperliquid's flat withdrawal fee, taken out of the amount withdrawn. */
export const HL_WITHDRAW_FEE = 1;
/** Below this Hyperliquid rejects the withdrawal outright. */
export const HL_MIN_WITHDRAW = 2;

const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? 0));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Reads the `userAbstraction` info response. It answers with a bare string —
 * "default" for a standard account — so anything else (today "unified" or a
 * portfolio-margin mode, tomorrow whatever they add) is treated as "spot is
 * the trading balance and class transfers are disabled". Testing for NOT
 * default rather than for a known list keeps a new mode from being read as a
 * standard account, which is the failure that costs a wasted signature.
 *
 * An unreadable answer counts as standard: that path still works on a unified
 * account, because the class transfer it attempts is caught and skipped.
 */
export function isUnifiedAccount(userAbstraction: unknown): boolean {
  const raw = typeof userAbstraction === 'string'
    ? userAbstraction
    // Defensive: an object form ({type|mode|abstraction: "unified"}) would
    // otherwise stringify to "[object Object]" and read as unified.
    : (userAbstraction as any)?.type ?? (userAbstraction as any)?.mode ?? (userAbstraction as any)?.abstraction;
  if (typeof raw !== 'string' || !raw) return false;
  return raw.trim().toLowerCase() !== 'default';
}

export function parseHLBalances(clearinghouse: any, spot: any, unified = false): HLBalances {
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
  // or PURR is not part of what can be moved this way. `hold` is the portion
  // reserved (margin on a unified account, resting orders on either), which
  // cannot leave.
  const balances: any[] = Array.isArray(spot?.balances) ? spot.balances : [];
  const usdc = balances.find(b => b?.coin === 'USDC');
  const spotFree = usdc ? Math.max(0, num(usdc.total) - num(usdc.hold)) : 0;

  // On a unified account the spot figure IS the trading balance across spot
  // and perps — adding the perp side would double-count it and hand MAX a
  // number the withdrawal then gets rejected for.
  if (unified) return { ready: spotFree, needsMove: 0, total: spotFree, unified: true };

  return { ready: perpAvail, needsMove: spotFree, total: perpAvail + spotFree, unified: false };
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

/**
 * Hyperliquid's /exchange errors come back in several shapes — a bare string
 * under `response`, a nested `response.data.message`, or a top-level `error`.
 * Reaching only for the nested one printed the whole JSON envelope at users
 * ({"status":"err","response":"Action disabled when unified account is
 * active"}), burying the one sentence that explained the failure.
 */
export function hlErrorMessage(d: any): string {
  if (typeof d?.response === 'string' && d.response.trim()) return d.response.trim();
  const nested = d?.response?.data?.message ?? d?.response?.data ?? d?.error;
  if (typeof nested === 'string' && nested.trim()) return nested.trim();
  return JSON.stringify(d ?? null).slice(0, 200);
}

/** Does this /exchange error mean "you are on a unified account"? */
export function isUnifiedAccountError(message: string): boolean {
  return /unified account/i.test(message);
}
