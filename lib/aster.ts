import type { Candle, OrderBook, Signer } from './hyperliquid';

// Our one shared Aster Pro API agent (server/lib/aster-auth.js holds the
// matching private key) — every user of this app approves this SAME address
// once via approveAsterAgent() below, after which our backend can read/trade
// for their account by including `user: <their address>` on each signed
// call. This is the "Aster Code" builder pattern, not a per-user key.
export const ASTER_AGENT_ADDRESS = '0xdA480541aDB8D00E4783E5180CE70D3Da52D99F9';

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
 * Real account snapshot for `userAddress` via our shared Pro API agent
 * (server/lib/aster-auth.js holds the agent's key) — requires that address
 * to have approved our agent first (see approveAsterAgent). Unlike
 * Hyperliquid, Aster has no permissionless "look up any address" endpoint;
 * every signed call must carry an explicit `user` param naming the account,
 * or Aster has no way to know which of our (potentially many) approved
 * users' data to return.
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

/**
 * One-time approval letting our shared Aster Pro API agent (ASTER_AGENT_ADDRESS,
 * private key in server/.env — see server/lib/aster-auth.js) read and trade
 * on `userAddress`'s behalf. Signed by the user's OWN wallet client-side —
 * this call is PUBLIC/unauthenticated on Aster's side and never touches our
 * server's key. canWithdraw is hardcoded false: the shared agent should never
 * be able to move funds out of a user's account, only trade with them.
 *
 * Field order in the signed message is significant — confirmed empirically
 * that Aster rejects the same values signed in any order other than exactly
 * this one (alphabetical order fails with "Signature check failed").
 */
export async function approveAsterAgent(userAddress: string, signer: Signer): Promise<{ ok: boolean; message: string }> {
  const nonce = Date.now() * 1000; // microseconds, per Aster's V3 nonce convention
  const expired = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year validity
  const chainId = 56; // BSC — required for EVM addresses per Aster's docs, NOT the usual 1666 domain chainId used elsewhere
  const fields = {
    user: userAddress,
    nonce: String(nonce),
    agentName: 'RDOONE',
    agentAddress: ASTER_AGENT_ADDRESS,
    expired: String(expired),
    signatureChainId: String(chainId),
    canSpotTrade: 'false',
    canPerpTrade: 'true',
    canWithdraw: 'false',
    ipWhitelist: '',
  };
  const msg = new URLSearchParams(fields).toString();

  const domain = { name: 'AsterSignTransaction', version: '1', chainId, verifyingContract: '0x0000000000000000000000000000000000000000' };
  const types = { Message: [{ name: 'msg', type: 'string' }] };

  try {
    const signature = await signer.signTypedData(domain, types, { msg });
    const res = await fetch('/api/aster-register-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, signature }),
    });
    const data = await res.json();
    return { ok: data.code === 200, message: data.msg ?? 'Unknown response' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Request failed' };
  }
}

/**
 * Best-effort check of whether `userAddress` has already approved our shared
 * agent. Aster has NO dedicated "is this agent approved?" endpoint — confirmed
 * against the V3 docs, whose only agent endpoint is registerAndApproveAgent —
 * so we infer it by probing a cheap signed read: if accountWithJoinMargin
 * returns a real snapshot, our agent can sign for this user (→ approved); a
 * null result means either not-approved or a transient error, which callers
 * treat the same way (offer approval). Reuses the same call the portfolio
 * loads anyway, so it adds no extra request weight when wired into that path.
 */
export async function isAsterAgentApproved(userAddress: string): Promise<boolean> {
  const account = await getAsterAccount(userAddress);
  return account !== null;
}

/**
 * Check-then-approve wrapper: only prompts the user's wallet for the on-chain
 * approval signature when the agent isn't already approved for `userAddress`.
 * This is what makes approval a "one time, and again only if needed" action
 * instead of a button the user must click on every visit. `getSigner` is a
 * callback (rather than a Signer) so the caller can lazily do wallet-side
 * prep — switching the wallet to BSC, building the ethers signer — ONLY on
 * the branch that actually needs to sign, never when already approved.
 */
export async function ensureAsterAgentApproved(
  userAddress: string,
  getSigner: () => Promise<Signer>,
): Promise<{ ok: boolean; alreadyApproved: boolean; message: string }> {
  if (await isAsterAgentApproved(userAddress)) {
    return { ok: true, alreadyApproved: true, message: 'Agent already approved' };
  }
  const signer = await getSigner();
  const result = await approveAsterAgent(userAddress, signer);
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

