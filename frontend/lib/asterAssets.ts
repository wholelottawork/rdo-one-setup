// Which currencies an Aster withdrawal can pay out, where, and as WHAT TOKEN.
//
// The withdrawal itself was never USDT-only — `asset` has always been a signed
// field (./asterWithdraw.ts) and a live BNB-on-BSC withdrawal is on record in
// docs/aster-withdrawal-findings.md. What was USDT-only is everything that
// happens AFTER Aster pays out: watching the funds arrive, and converting them.
// Both need to know the token's identity on the destination chain, and that is
// what this file carries.
//
// Two things here are load-bearing and neither is guessable from the symbol:
//
//   DECIMALS ARE NOT A PROPERTY OF THE ASSET. USDT is 6 decimals on Ethereum
//   and Arbitrum and 18 on BNB Chain. Every arrival check in the transfer page
//   used to hardcode 1e6, which is correct only for the one pairing it shipped
//   with; on BSC it would wait for a trillion times the real amount and time
//   out on a withdrawal that had already landed.
//
//   NATIVE IS NOT AN ERC-20. BNB on BSC and ETH on Ethereum/Arbitrum arrive as
//   the chain's own gas token, which has no balanceOf to poll and no contract
//   to approve. eth_call against the zero address answers '0x', which the page
//   correctly refuses to read as a balance — so the whole flow has to branch on
//   this, not just the address.
//
// The chain set per asset comes from Aster's own estimateFee endpoint, probed
// live: every pairing below answers with a fee, and every pairing NOT below
// answers "Unsupport token". Aster also quotes BTC (chains 1, 56) and ASTER
// (chain 56); both are left out deliberately — see ASTER_UNMAPPED_ASSETS.

/** LI.FI and this app both name a chain's native token by the zero address. */
export const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000';

export interface AsterPayoutToken {
  /** ERC-20 address, or NATIVE_TOKEN for the chain's gas token. */
  address: string;
  /** Of THIS token on THIS chain. Never assume it from the symbol. */
  decimals: number;
  /** Gas token: poll eth_getBalance, never balanceOf, and leave gas behind
   *  when converting — the balance being spent is the one paying the fee. */
  native: boolean;
}

const erc20 = (address: string, decimals: number): AsterPayoutToken => ({
  address,
  decimals,
  native: false,
});
const native: AsterPayoutToken = { address: NATIVE_TOKEN, decimals: 18, native: true };

/**
 * asset -> chainId -> the token Aster actually delivers there.
 *
 * Chain ids are limited to 1 / 56 / 42161 on purpose beyond just what Aster
 * supports: the withdrawal authorization is an EIP-712 payload stamped with
 * the destination chainId, so the wallet has to be switched to that chain to
 * sign it, and it can only be switched to a network the app can describe.
 */
export const ASTER_PAYOUT_TOKENS: Record<string, Record<string, AsterPayoutToken>> = {
  USDT: {
    '1':     erc20('0xdac17f958d2ee523a2206206994597c13d831ec7', 6),
    '56':    erc20('0x55d398326f99059ff775485246999027b3197955', 18),
    '42161': erc20('0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', 6),
  },
  USDC: {
    '1':     erc20('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 6),
    '56':    erc20('0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', 18),
    '42161': erc20('0xaf88d065e77c8cc2239327c5edb3a432268e5831', 6),
  },
  ETH: {
    '1':     native,
    // Binance-pegged ETH, an ordinary ERC-20 — NOT the gas token here.
    '56':    erc20('0x2170ed0880ac9a755fd29b2688956bd959f933f8', 18),
    '42161': native,
  },
  BNB: {
    '56':    native,
  },
};

/**
 * Assets Aster quotes a withdrawal fee for that this app deliberately does NOT
 * offer, and why. Kept as data rather than a comment so the reason travels with
 * the next person who wonders where BTC went.
 *
 * Adding one is not a matter of listing it: the payout token has to be
 * confirmed against a real withdrawal first, because the failure mode of a
 * wrong address is a conversion leg that never fires and funds that sit in the
 * wallet looking lost.
 */
export const ASTER_UNMAPPED_ASSETS: Record<string, string> = {
  // Quoted on chains 1 and 56. Aster publishes no token address and the two
  // chains would differ (WBTC vs BTCB), so this is unverified either way.
  BTC: 'Aster does not publish which BTC token it pays out',
  // Quoted on chain 56 only. The conversion leg would need BNB for gas, and an
  // account withdrawing ASTER has no reason to hold any — the funds would land
  // and then be stuck.
  ASTER: 'needs BNB for gas on the only chain it pays out on',
  // Quoted on chains 1 and 56. Same problem as BTC.
  USD1: 'payout token address not yet confirmed',
};

/** Picker order — stables first, since that is what most withdrawals are. */
export const ASTER_WITHDRAW_ASSETS = ['USDT', 'USDC', 'ETH', 'BNB'];

/** Dollar-denominated, so two decimals is the whole story. Everything else
 *  needs more (see asterDisplayDecimals). */
export const ASTER_STABLES = new Set(['USDT', 'USDC', 'USD1']);

/** The token Aster delivers for `asset` on `chainId`, or null when it does not
 *  pay that pairing out at all. Callers MUST treat null as "cannot withdraw
 *  here" rather than falling back to a default — the fallback is what turns a
 *  routing mistake into a rejected signature. */
export function asterPayoutToken(asset: string, chainId: string): AsterPayoutToken | null {
  return ASTER_PAYOUT_TOKENS[asset]?.[chainId] ?? null;
}

/** Chains Aster will pay `asset` out on, in this app's preferred order. */
export function asterWithdrawChains(asset: string): string[] {
  return Object.keys(ASTER_PAYOUT_TOKENS[asset] ?? {});
}

export function isAsterWithdrawAsset(asset: string): boolean {
  return asset in ASTER_PAYOUT_TOKENS;
}

/**
 * Decimal places to SHOW an amount of `asset` in.
 *
 * Two places is right for a dollar and useless for a gas token: a real
 * withdrawable BNB balance was 0.019, which rounds to "0.02" — and MAX writing
 * that back into the amount field asks for more than the account holds.
 */
export function asterDisplayDecimals(asset: string): number {
  return ASTER_STABLES.has(asset) ? 2 : 6;
}

/**
 * Largest amount of `asset` that can be written back into an amount field,
 * given a balance — i.e. MAX. Truncates rather than rounds, at the display
 * precision, because rounding up is the direction that asks Aster for money
 * the account does not have.
 */
export function asterMaxAmount(balance: number, asset: string): string {
  const d = asterDisplayDecimals(asset);
  const factor = 10 ** d;
  const truncated = Math.floor(balance * factor) / factor;
  return truncated.toFixed(d);
}
