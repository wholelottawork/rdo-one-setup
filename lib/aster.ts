import type { Candle, OrderBook, Signer } from './hyperliquid';

// Each user gets their OWN dedicated Aster Pro API agent keypair, minted
// and held server-side (server/lib/agent-keystore.js) — NOT one shared
// address. Aster's signed reads/trades resolve account identity from the
// signer alone (confirmed against Aster's own docs and reference client:
// GET /fapi/v3/accountWithJoinMargin, /balance, /positionRisk, /income,
// /userTrades take no `user` parameter at all), so a single shared agent
// could only ever be "live" for the one user who most recently approved
// it. Aster's own integration flow explicitly recommends this
// ("recommended: one signer per user" — asterdex.github.io/aster-api-website/
// asterCode/integration-flow/). getMyAsterAgentAddress() below fetches (and
// implicitly creates) the caller's own agent address; nothing in this file
// hardcodes one anymore.

export interface AsterTicker {
  symbol: string;
  lastPrice: number;
  openPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
}

/**
 * Every tradeable Aster perp, straight from the exchange — replaces the old
 * hand-picked ASTER_MARKETS list so we show whatever Aster actually offers
 * (currently 500+ symbols) instead of a stale curated subset. Verified live
 * against GET /fapi/v1/exchangeInfo: quoteAsset is USDT for all of these
 * (Aster is USDT-margined; some symbols are quoted in "USD1"/"U" instead —
 * excluded here since our UI assumes a uniform -USDT pair convention).
 */
export async function getAsterSymbols(): Promise<string[]> {
  try {
    const res = await fetch('/api/aster-fapi/fapi/v1/exchangeInfo');
    const data = await res.json();
    const symbols = Array.isArray(data?.symbols) ? data.symbols : [];
    return symbols
      .filter((s: Record<string, string>) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT')
      .map((s: Record<string, string>) => String(s.symbol).replace(/USDT$/, ''))
      .sort();
  } catch {
    return [];
  }
}

export async function getAsterTickers(): Promise<AsterTicker[]> {
  try {
    const res = await fetch('/api/aster-fapi/fapi/v1/ticker/24hr');
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((t: Record<string, string>) => ({
      symbol: String(t.symbol).replace('USDT', ''),
      lastPrice: parseFloat(t.lastPrice ?? '0'),
      openPrice: parseFloat(t.openPrice ?? t.lastPrice ?? '0'),
      priceChangePercent: parseFloat(t.priceChangePercent ?? '0'),
      quoteVolume: parseFloat(t.quoteVolume ?? '0'),
    }));
  } catch {
    return [];
  }
}

export async function getAsterFunding(): Promise<Record<string, number>> {
  try {
    const res = await fetch('/api/aster-fapi/fapi/v1/premiumIndex');
    const data = await res.json();
    if (!Array.isArray(data)) return {};
    const out: Record<string, number> = {};
    data.forEach((t: Record<string, string>) => {
      const sym = String(t.symbol).replace('USDT', '');
      out[sym] = parseFloat(t.lastFundingRate ?? '0') * 100;
    });
    return out;
  } catch {
    return {};
  }
}

const IV_MAP: Record<number, string> = { 1: '1m', 3: '3m', 5: '5m', 15: '15m', 60: '1h', 240: '4h', 1440: '1d' };

export async function getAsterCandles(symbol: string, intervalMinutes: number, count = 200): Promise<Candle[]> {
  try {
    const iv = IV_MAP[intervalMinutes] || '1m';
    const res = await fetch(`/api/aster-fapi/fapi/v1/klines?symbol=${symbol}USDT&interval=${iv}&limit=${count}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((c: [number, string, string, string, string, string]) => ({
      t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5],
    }));
  } catch {
    return [];
  }
}

export async function getAsterBook(symbol: string): Promise<OrderBook> {
  try {
    const res = await fetch(`/api/aster-fapi/fapi/v1/depth?symbol=${symbol}USDT&limit=20`);
    const data = await res.json();
    return {
      asks: (data.asks ?? []).map(([px, sz]: [string, string]) => ({ px: +px, sz: +sz })),
      bids: (data.bids ?? []).map(([px, sz]: [string, string]) => ({ px: +px, sz: +sz })),
    };
  } catch {
    return { asks: [], bids: [] };
  }
}

/**
 * Real per-symbol max leverage from Aster's Pro API (V3), replacing the
 * fixed "200x" label — that was only ever a stand-in because the endpoint is
 * signed (USER_DATA) and we had no agent registered. brackets[0] is always
 * the lowest-notional / highest-leverage tier, so its initialLeverage is the
 * "up to Nx" headline number (200x for majors like BTC/ETH, much lower for
 * smaller-cap symbols — e.g. 5x for SUSHIUSDT — so do NOT assume 200x here).
 */
export async function getAsterLeverageBrackets(): Promise<Record<string, number>> {
  try {
    const res = await fetch('/api/aster-leverage-brackets');
    const data = await res.json();
    if (!Array.isArray(data)) return {};
    const out: Record<string, number> = {};
    data.forEach((entry: { symbol: string; brackets?: Array<{ initialLeverage: number }> }) => {
      const maxLev = entry.brackets?.[0]?.initialLeverage;
      if (maxLev) out[String(entry.symbol).replace(/USDT$/, '')] = maxLev;
    });
    return out;
  } catch {
    return {};
  }
}

export interface AsterPosition {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  unrealizedProfit: number;
  leverage: number;
}

export interface AsterAccountInfo {
  totalWalletBalance: number;
  totalMarginBalance: number;
  totalUnrealizedProfit: number;
  totalPositionInitialMargin: number;
  totalOpenOrderInitialMargin: number;
  availableBalance: number;
  positions: AsterPosition[];
}

/**
 * Real account snapshot for `userAddress` via THEIR OWN dedicated Pro API
 * agent (server/lib/agent-keystore.js mints and holds it server-side) —
 * requires that address to have approved its agent first (see
 * approveAsterAgent). The backend resolves which agent key to sign with
 * from this same `user` query param — see server/routes/proxy.js's
 * requireUserAgent.
 *
 * GET /fapi/v3/accountWithJoinMargin itself takes no `user` parameter per
 * Aster's docs (confirmed against asterdex.github.io/aster-api-website/
 * futures-v3/account%26trades/ and github.com/asterdex/API-demo) — it
 * resolves the account from the signer alone, which is exactly why this
 * has to be a per-user agent rather than one shared one.
 */
export async function getAsterAccount(userAddress: string): Promise<AsterAccountInfo | null> {
  try {
    const res = await fetch(`/api/aster-signed/fapi/v3/accountWithJoinMargin?user=${userAddress}`);
    const data = await res.json();
    if (!data || typeof data !== 'object' || !Array.isArray(data.positions)) return null;
    return {
      totalWalletBalance: parseFloat(data.totalWalletBalance ?? '0'),
      totalMarginBalance: parseFloat(data.totalMarginBalance ?? '0'),
      totalUnrealizedProfit: parseFloat(data.totalUnrealizedProfit ?? '0'),
      totalPositionInitialMargin: parseFloat(data.totalPositionInitialMargin ?? '0'),
      totalOpenOrderInitialMargin: parseFloat(data.totalOpenOrderInitialMargin ?? '0'),
      availableBalance: parseFloat(data.availableBalance ?? '0'),
      positions: (data.positions as Array<Record<string, string>>)
        .filter(p => parseFloat(p.positionAmt ?? '0') !== 0)
        .map(p => ({
          symbol: String(p.symbol).replace(/USDT$/, ''),
          positionAmt: parseFloat(p.positionAmt ?? '0'),
          entryPrice: parseFloat(p.entryPrice ?? '0'),
          unrealizedProfit: parseFloat(p.unrealizedProfit ?? '0'),
          leverage: parseFloat(p.leverage ?? '0'),
        })),
    };
  } catch {
    return null;
  }
}

export interface AsterIncomeEntry {
  symbol: string;
  income: number;
  time: number;
}

// ── Aster account data types (for terminal integration) ────────────────────

export interface AsterFill {
  coin: string;
  side: 'Buy' | 'Sell';
  price: number;
  size: number;
  fee: number;
  pnl: number;
  dir: string;
  time: number;
  hash: string;
  oid: number;
}

export interface AsterOpenOrder {
  coin: string;
  side: 'Buy' | 'Sell';
  price: number;
  size: number;
  origSize: number;
  oid: number;
  time: number;
}

export interface AsterFundingEntry {
  coin: string;
  usdc: number;
  rate: number;
  size: number;
  time: number;
}

// Map Aster position to the common Position interface used by the terminal UI
export interface AsterMappedPosition {
  symbol: string;
  size: number;
  entryPrice: number;
  leverage: number;
  pnl: number;
  liqPrice: number;
  isLong: boolean;
}

const INCOME_WINDOW_MS = 6.9 * 24 * 60 * 60 * 1000; // just under Aster's 7-day-per-call cap
const INCOME_BATCH = 5;

/**
 * Realized PnL history for `userAddress` via GET /fapi/v3/income
 * (incomeType=REALIZED_PNL) — covers every symbol in one logical fetch,
 * unlike /fapi/v3/userTrades which requires a single mandatory `symbol` and
 * can't answer "all of this account's trades." The tradeoff: income entries
 * carry pnl + symbol + time, not per-trade entry/exit price or size — enough
 * to drive total PnL, win rate, best/worst, and PnL-over-time charts, but not
 * a HL-style trade table with entry/exit prices.
 *
 * Each call is capped to a ~7-day window (Aster's real limit), so a longer
 * range is chunked into windows and fetched in small batches to stay well
 * under Aster's request-weight limit regardless of how far back we look.
 */
export async function getAsterIncomeHistory(sinceMs: number, userAddress: string): Promise<AsterIncomeEntry[]> {
  const now = Date.now();
  const windows: Array<{ start: number; end: number }> = [];
  for (let end = now; end > sinceMs; end -= INCOME_WINDOW_MS) {
    windows.push({ start: Math.max(sinceMs, end - INCOME_WINDOW_MS), end });
  }

  const out: AsterIncomeEntry[] = [];
  for (let i = 0; i < windows.length; i += INCOME_BATCH) {
    const batch = windows.slice(i, i + INCOME_BATCH);
    const results = await Promise.all(batch.map(async ({ start, end }) => {
      try {
        const res = await fetch(`/api/aster-signed/fapi/v3/income?incomeType=REALIZED_PNL&startTime=${start}&endTime=${end}&limit=1000&user=${userAddress}`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    }));
    results.forEach(entries => {
      (entries as Array<Record<string, string>>).forEach(e => {
        out.push({
          symbol: String(e.symbol ?? '').replace(/USDT$/, ''),
          income: parseFloat(e.income ?? '0'),
          time: Number(e.time),
        });
      });
    });
  }

  return out.sort((a, b) => a.time - b.time);
}

// Open interest per symbol (USD notional) — ported from main.js fetchAsterOI().
// Binance-style futures APIs (Aster included) have no bulk OI endpoint, only
// one symbol per call. With the full live symbol list (500+ pairs, not a
// hand-picked 20), issuing one browser-facing request per symbol single-
// handedly exhausted our own backend's rate limiter (200 req/60s per IP) —
// so the fan-out now happens server-side in one call (see the
// /aster-oi-bulk route in server/routes/proxy.js, which still batches its
// own calls to Aster the same way this used to client-side).
export async function getAsterOpenInterest(symbols: string[], prices: Record<string, number>): Promise<Record<string, number>> {
  if (symbols.length === 0) return {};
  try {
    const res = await fetch('/api/aster-oi-bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbols }),
    });
    const data: Record<string, number> = await res.json();
    const out: Record<string, number> = {};
    Object.entries(data).forEach(([sym, oi]) => { out[sym] = oi * (prices[sym] || 0); });
    return out;
  } catch {
    return {};
  }
}

// Aster Code (docs.asterdex.com "Aster Code" builder program): approveAgent
// "supports setting builder and maxFeeRate to approve the builder at the
// same time" — riding on the same signed call as agent approval, rather than
// a separate one, is what lets us collect a per-trade fee. `builder` is a
// FIXED business-identity address (used purely for fee attribution),
// unrelated to whichever per-user agent actually signs a given trade.
export const ASTER_BUILDER_ADDRESS = '0xdA480541aDB8D00E4783E5180CE70D3Da52D99F9';
export const ASTER_BUILDER_MAX_FEE_RATE = '0.0001'; // 0.01%

// Confirmed live against fapi.asterdex.com: attaching `builder` to
// ApproveAgent before ASTER_BUILDER_ADDRESS is registered fails the whole
// call with "Builder address:... not registered in Aster" — per Aster's
// integration flow, the builder address must be registered on
// asterdex.com AND funded with >=100 ASTER before any ApproveAgent call
// naming it can succeed. That's a one-time business setup step on Aster's
// site, not something this code can do. Flip this to true once that step
// is done — until then, agent approval (reads/trades) still works fully;
// only fee attribution is on hold.
const ASTER_BUILDER_REGISTERED = false;

/** Fetches (creating on first call) `userAddress`'s own dedicated Aster
 *  agent address — never a private key, just the public address needed as
 *  `agentAddress` when signing approveAgent. See server/lib/agent-keystore.js. */
export async function getMyAsterAgentAddress(userAddress: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/aster-agent-address?user=${encodeURIComponent(userAddress)}`);
    const data = await res.json();
    return typeof data?.agentAddress === 'string' ? data.agentAddress : null;
  } catch {
    return null;
  }
}

type Eip712Value = string | number | boolean;

function capitalizeKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// Matches Aster's own reference client's type-inference exactly (see
// signAsterManagementAction's doc comment) — booleans and integers get
// their natural Solidity type, everything else (including decimal amounts
// like maxFeeRate, which must stay a string) falls through to `string`.
function inferEip712Type(value: Eip712Value): string {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number' && Number.isInteger(value)) return 'uint256';
  return 'string';
}

/**
 * Signs an Aster Code "management" action (ApproveAgent, ApproveBuilder,
 * UpdateAgent, ...) with the user's own wallet. This is a genuinely
 * different EIP-712 scheme from every other signed call in this file: a
 * per-action typed struct (dynamic primaryType, e.g. "ApproveAgent"), not
 * the generic Message{msg:string} wrapper accountWithJoinMargin/income/etc
 * use (that wrapper is for the OTHER Aster signature mode — "trading",
 * signed by the agent's own key, always domain chainId 1666; see
 * server/lib/aster-auth.js). Management actions are signed by the user's
 * main wallet, field names are capitalized (agentName -> AgentName), and
 * domain chainId is fixed at 56 — none of which the prose docs spell out in
 * full; ported verbatim from Aster's reference implementation
 * (github.com/asterdex/API-demo/tree/main/aster-code-demo, utils.js's
 * signEIP712Main + 01_approveAgent.js) since getting this wrong just means
 * a silently-rejected signature, not a dangerous one — but it's still worth
 * getting right the first time given this grants trading authority.
 */
async function signAsterManagementAction(
  signer: Signer,
  primaryType: string,
  params: Record<string, Eip712Value>,
): Promise<string> {
  const message: Record<string, Eip712Value> = {};
  const fields: Array<{ name: string; type: string }> = [];
  for (const [key, value] of Object.entries(params)) {
    const capKey = capitalizeKey(key);
    message[capKey] = value;
    fields.push({ name: capKey, type: inferEip712Type(value) });
  }
  const domain = { name: 'AsterSignTransaction', version: '1', chainId: 56, verifyingContract: '0x0000000000000000000000000000000000000000' };
  return signer.signTypedData(domain, { [primaryType]: fields }, message);
}

/**
 * One-time approval letting `userAddress`'s OWN dedicated Aster Pro API
 * agent (see getMyAsterAgentAddress — a fresh keypair per user, held
 * server-side in server/lib/agent-keystore.js) read and trade on their
 * behalf. Signed by the user's OWN wallet client-side — this call is
 * PUBLIC/unauthenticated on Aster's side and never touches any of our
 * server's keys. canWithdraw is hardcoded false: an agent should never be
 * able to move funds out of a user's account, only trade with them.
 *
 * Calls POST /fapi/v3/approveAgent — the Aster Code builder-program endpoint
 * (asterdex.github.io/aster-api-website/asterCode/endpoints/) — NOT the
 * older /fapi/v3/registerAndApproveAgent from the general V3 docs, which
 * this used to call: registerAndApproveAgent doesn't document (and, tested,
 * doesn't honor) the builder/maxFeeRate/builderName fields needed to
 * collect a per-trade fee.
 */
export async function approveAsterAgent(userAddress: string, agentAddress: string, signer: Signer): Promise<{ ok: boolean; message: string }> {
  const nonce = Date.now() * 1000; // microseconds, per Aster's V3 nonce convention
  const expired = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year validity

  // Field set and order match Aster's own reference implementation
  // (github.com/jupiter-hongc/aster-code-builder-demo/docs/demo-code.md's
  // send_by_url) verbatim, confirmed live against fapi.asterdex.com — two
  // things neither the public docs nor the more commonly-linked demo repo
  // (asterdex/API-demo) mention: `asterChain: 'Mainnet'` must be part of
  // the SIGNED struct (its absence is why every approval silently failed
  // signature verification before), and `signatureChainId` is a separate
  // WIRE-ONLY param added after signing, not part of what's signed.
  const params: Record<string, Eip712Value> = {
    agentName: 'RDOONE',
    agentAddress,
    ipWhitelist: '',
    expired,
    canSpotTrade: false,
    canPerpTrade: true,
    canWithdraw: false,
    ...(ASTER_BUILDER_REGISTERED ? {
      builder: ASTER_BUILDER_ADDRESS,
      maxFeeRate: ASTER_BUILDER_MAX_FEE_RATE,
      builderName: 'RDOONE',
    } : {}),
    asterChain: 'Mainnet',
    user: userAddress,
    nonce,
  };
  try {
    const signature = await signAsterManagementAction(signer, 'ApproveAgent', params);
    const res = await fetch('/api/aster-approve-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, signatureChainId: 56, signature }),
    });
    const data = await res.json();
    return { ok: data.code === 200, message: data.msg ?? data.error ?? 'Unknown response' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Request failed' };
  }
}

export interface AsterAgentApproval {
  agentAddress: string;
  agentName: string;
  canPerpTrade: boolean;
  canSpotTrade: boolean;
  canWithdraw: boolean;
  expired: number;
}

/** GET /fapi/v3/agent — the list of agents `userAddress` has approved.
 *  Signed server-side by that same user's own dedicated agent key (the
 *  backend resolves which key from this `user` query param — see
 *  server/routes/proxy.js's requireUserAgent) — this lookup endpoint DOES
 *  accept and honor an explicit `user` param, unlike accountWithJoinMargin/
 *  income/etc (see getAsterAccount's doc comment for the endpoints that
 *  don't). */
export async function getAsterAgents(userAddress: string): Promise<AsterAgentApproval[]> {
  try {
    const res = await fetch(`/api/aster-signed/fapi/v3/agent?user=${encodeURIComponent(userAddress)}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Is `userAddress`'s own dedicated agent (`agentAddress`, from
 * getMyAsterAgentAddress) currently approved and not expired — via GET
 * /fapi/v3/agent, the documented, per-user-scoped way to check this.
 * Previously this was inferred by probing accountWithJoinMargin and
 * treating a non-null response as "approved" — which conflated two
 * different things, since accountWithJoinMargin doesn't take a `user`
 * param at all and would return SOME account as long as the (then shared)
 * agent had a live mapping to anyone.
 */
export async function isAsterAgentApproved(userAddress: string, agentAddress: string): Promise<boolean> {
  const agents = await getAsterAgents(userAddress);
  const now = Date.now();
  return agents.some(a =>
    a.agentAddress?.toLowerCase() === agentAddress.toLowerCase() &&
    a.canPerpTrade &&
    (!a.expired || a.expired > now),
  );
}

export interface AsterBuilderApproval {
  userAddress: string;
  builderAddress: string;
  maxFeeRate: number;
  builderName: string;
}

/** GET /fapi/v3/builder — the list of builders this user has approved, with
 *  their fee-rate caps. Signed server-side by our agent (same pattern as
 *  every other /aster-signed/* read). */
export async function getAsterBuilders(userAddress: string): Promise<AsterBuilderApproval[]> {
  try {
    const res = await fetch(`/api/aster-signed/fapi/v3/builder?user=${encodeURIComponent(userAddress)}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Is OUR builder address specifically approved (with a nonzero fee cap) for
 *  this user — separate from agent approval, since a user could have
 *  approved the agent (reads/trades) before this builder-fee field existed
 *  and never been asked to approve the fee itself. */
export async function isAsterBuilderApproved(userAddress: string): Promise<boolean> {
  const builders = await getAsterBuilders(userAddress);
  return builders.some(b => b.builderAddress?.toLowerCase() === ASTER_BUILDER_ADDRESS.toLowerCase() && b.maxFeeRate > 0);
}

/**
 * Check-then-approve wrapper: only prompts the user's wallet for the on-chain
 * approval signature when the agent AND builder fee aren't already approved
 * for `userAddress`. This is what makes approval a "one time, and again only
 * if needed" action instead of a button the user must click on every visit —
 * a user who already approved the agent but never the builder fee (or vice
 * versa) gets re-prompted once to cover whichever is missing; the same
 * signed call sets both. `getSigner` is a callback (rather than a Signer) so
 * the caller can lazily do wallet-side prep — switching the wallet to BSC,
 * building the ethers signer — ONLY on the branch that actually needs to
 * sign, never when already fully approved.
 *
 * Always resolves `userAddress`'s own dedicated agent address first (a
 * cheap Redis-backed lookup, never a wallet prompt) — needed to know what
 * to check approval against, and what to sign if approval is still needed.
 */
export async function ensureAsterAgentApproved(
  userAddress: string,
  getSigner: () => Promise<Signer>,
): Promise<{ ok: boolean; alreadyApproved: boolean; message: string }> {
  const agentAddress = await getMyAsterAgentAddress(userAddress);
  if (!agentAddress) {
    return { ok: false, alreadyApproved: false, message: 'Could not allocate a trading agent — try again' };
  }
  // Builder approval isn't requested at all while ASTER_BUILDER_REGISTERED
  // is false (see approveAsterAgent) — checking for it here too would mean
  // this NEVER short-circuits (isAsterBuilderApproved can never return
  // true for a builder we never asked the user to approve), re-prompting
  // a signature on every single load even for an already-agent-approved
  // user. Only require it once we're actually asking for it.
  const [agentOk, builderOk] = await Promise.all([
    isAsterAgentApproved(userAddress, agentAddress),
    ASTER_BUILDER_REGISTERED ? isAsterBuilderApproved(userAddress) : Promise.resolve(true),
  ]);
  if (agentOk && builderOk) {
    return { ok: true, alreadyApproved: true, message: 'Agent already approved' };
  }
  const signer = await getSigner();
  const result = await approveAsterAgent(userAddress, agentAddress, signer);
  return { ok: result.ok, alreadyApproved: false, message: result.message };
}

/**
 * User Data Stream (listenKey) lifecycle — POST to start, PUT to keepalive
 * (required every ~60min or the stream expires), DELETE to close. This is
 * the alternative Aster's own docs recommend over REST polling: once
 * connected to wss://fstream.asterdex.com/ws/<listenKey>, balance/position
 * changes get PUSHED (ACCOUNT_UPDATE events) instead of us having to poll
 * accountWithJoinMargin repeatedly — the thing that scales badly once many
 * users are doing it concurrently against our one shared IP's rate limit.
 * Goes through our existing signed-endpoint proxy (server/lib/aster-auth.js
 * signs with OUR agent, same as every other USER_STREAM/USER_DATA call).
 */
export async function startAsterUserStream(userAddress: string): Promise<string | null> {
  try {
    const res = await fetch('/api/aster-signed/fapi/v3/listenKey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userAddress }),
    });
    const data = await res.json();
    return typeof data?.listenKey === 'string' ? data.listenKey : null;
  } catch {
    return null;
  }
}

export async function keepaliveAsterUserStream(userAddress: string): Promise<void> {
  try {
    await fetch('/api/aster-signed/fapi/v3/listenKey', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userAddress }),
    });
  } catch { /* best-effort — a missed keepalive just means a later reconnect */ }
}

export async function closeAsterUserStream(userAddress: string): Promise<void> {
  try {
    await fetch('/api/aster-signed/fapi/v3/listenKey', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user: userAddress }),
    });
  } catch { /* best-effort cleanup — an unclosed key just expires after 60min */ }
}

export function asterUserStreamWsUrl(listenKey: string): string {
  return `wss://fstream.asterdex.com/ws/${listenKey}`;
}

// ── Terminal account data fetchers (map to common interfaces) ───────────────

/** Wallet balance for the trade panel — uses availableBalance from account snapshot. */
export async function getAsterBalance(userAddress: string): Promise<number> {
  const account = await getAsterAccount(userAddress);
  return account?.availableBalance ?? 0;
}

/** Positions mapped to the common Position interface the terminal UI expects. */
export async function getAsterPositions(userAddress: string): Promise<AsterMappedPosition[]> {
  const account = await getAsterAccount(userAddress);
  if (!account) return [];
  return account.positions.map(p => ({
    symbol: p.symbol,
    size: p.positionAmt,
    entryPrice: p.entryPrice,
    leverage: p.leverage,
    pnl: p.unrealizedProfit,
    liqPrice: 0, // Aster account snapshot doesn't include liq price; would need separate call
    isLong: p.positionAmt > 0,
  }));
}

/** Trade fills from Aster's userTrades endpoint — one call per symbol, so we
 *  only fetch for symbols the user actually has positions in (avoids 500+
 *  requests). Falls back to empty if no positions. */
export async function getAsterFills(userAddress: string): Promise<AsterFill[]> {
  const account = await getAsterAccount(userAddress);
  const symbols = account?.positions.map(p => p.symbol) ?? [];
  if (symbols.length === 0) return [];

  const out: AsterFill[] = [];
  // Fetch trades for each symbol with an open position (limit to avoid abuse)
  const limitedSymbols = symbols.slice(0, 20);
  const results = await Promise.allSettled(
    limitedSymbols.map(async (sym) => {
      try {
        const res = await fetch(`/api/aster-signed/fapi/v3/userTrades?symbol=${sym}USDT&limit=100&user=${userAddress}`);
        const data = await res.json();
        if (!Array.isArray(data)) return [];
        return data.map((t: Record<string, string>) => ({
          coin: String(t.symbol ?? '').replace(/USDT$/, ''),
          side: parseFloat(t.realizedPnl ?? '0') >= 0 ? 'Buy' as const : 'Sell' as const,
          price: parseFloat(t.price ?? '0'),
          size: parseFloat(t.qty ?? '0'),
          fee: parseFloat(t.commission ?? '0'),
          pnl: parseFloat(t.realizedPnl ?? '0'),
          dir: String(t.side ?? ''),
          time: Number(t.time),
          hash: String(t.id ?? ''),
          oid: Number(t.id ?? 0),
        }));
      } catch {
        return [];
      }
    })
  );
  results.forEach(r => {
    if (r.status === 'fulfilled') out.push(...r.value);
  });
  return out.sort((a, b) => b.time - a.time);
}

/** Open orders via the signed allOrders endpoint (filtered to NEW/PARTIALLY_FILLED). */
export async function getAsterOpenOrders(userAddress: string): Promise<AsterOpenOrder[]> {
  try {
    const res = await fetch(`/api/aster-signed/fapi/v3/allOrders?limit=100&user=${userAddress}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((o: Record<string, string>) => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED')
      .map((o: Record<string, string>) => ({
        coin: String(o.symbol ?? '').replace(/USDT$/, ''),
        side: o.side === 'BUY' ? 'Buy' as const : 'Sell' as const,
        price: parseFloat(o.price ?? '0'),
        size: parseFloat(o.origQty ?? '0') - parseFloat(o.executedQty ?? '0'),
        origSize: parseFloat(o.origQty ?? '0'),
        oid: Number(o.orderId ?? 0),
        time: Number(o.time ?? 0),
      }));
  } catch {
    return [];
  }
}

/** Funding history via the signed income endpoint (incomeType=FUNDING_FEE). */
export async function getAsterFundingHistory(userAddress: string): Promise<AsterFundingEntry[]> {
  try {
    const res = await fetch(`/api/aster-signed/fapi/v3/income?incomeType=FUNDING_FEE&limit=100&user=${userAddress}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map((f: Record<string, string>) => ({
      coin: String(f.symbol ?? '').replace(/USDT$/, ''),
      usdc: parseFloat(f.income ?? '0'),
      rate: 0, // Aster income endpoint doesn't include the rate directly
      size: 0,  // Not available in this endpoint
      time: Number(f.time ?? 0),
    }));
  } catch {
    return [];
  }
}

// ── Aster trading functions (signed by user via our agent) ───────────────────

export interface AsterTradeParams {
  symbol: string;
  size: number;        // coin quantity (notional / price)
  price: number;       // limit price; 0 for market
  isLong: boolean;
  isMarket: boolean;
  userAddress: string;
}

/** Place an order on Aster via the shared Pro API agent.
 *  The backend signs with the agent key; user identity comes from `user` param. */
export async function asterPlaceOrder(params: AsterTradeParams): Promise<{ status: 'ok' | 'err'; response?: string }> {
  const { symbol, size, price, isLong, isMarket, userAddress } = params;
  const side = isLong ? 'BUY' : 'SELL';
  const type = isMarket ? 'MARKET' : 'LIMIT';
  const timeInForce = isMarket ? 'GTC' : 'GTC'; // MARKET doesn't need TIF, but API may require it

  try {
    const body: Record<string, string> = {
      symbol: `${symbol}USDT`,
      side,
      type,
      quantity: String(size),
      user: userAddress,
    };
    if (!isMarket) {
      body.price = String(price);
      body.timeInForce = timeInForce;
    }

    const res = await fetch('/api/aster-signed/fapi/v3/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.orderId || data.status) {
      return { status: 'ok' };
    }
    return { status: 'err', response: data.msg ?? JSON.stringify(data) };
  } catch (e) {
    return { status: 'err', response: e instanceof Error ? e.message : 'Order failed' };
  }
}

/** Close a position by placing a reduce-only market order on the opposite side. */
export async function asterClosePosition(
  { symbol, size, isLong, userAddress }: { symbol: string; size: number; isLong: boolean; userAddress: string },
): Promise<{ status: 'ok' | 'err'; response?: string }> {
  return asterPlaceOrder({
    symbol,
    size: Math.abs(size),
    price: 0,
    isLong: !isLong,
    isMarket: true,
    userAddress,
  });
}

/** Cancel an open order by orderId. */
export async function asterCancelOrder(
  { oid, symbol, userAddress }: { oid: number; symbol: string; userAddress: string },
): Promise<{ status: 'ok' | 'err'; response?: string }> {
  try {
    const res = await fetch('/api/aster-signed/fapi/v3/order', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        symbol: `${symbol}USDT`,
        orderId: String(oid),
        user: userAddress,
      }),
    });
    const data = await res.json();
    if (data.orderId || data.status === 'CANCELED') {
      return { status: 'ok' };
    }
    return { status: 'err', response: data.msg ?? JSON.stringify(data) };
  } catch (e) {
    return { status: 'err', response: e instanceof Error ? e.message : 'Cancel failed' };
  }
}

