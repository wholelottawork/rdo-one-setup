import type { Candle, OrderBook } from './hyperliquid';

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
 * Real account snapshot for OUR configured Aster agent (server/lib/aster-auth.js)
 * — NOT a lookup by arbitrary address. Aster's signed endpoints only return
 * data for whichever account the registered agent is approved on; there is no
 * public "look up any address's positions" endpoint the way Hyperliquid has.
 */
export async function getAsterAccount(): Promise<AsterAccountInfo | null> {
  try {
    const res = await fetch('/api/aster-signed/fapi/v3/accountWithJoinMargin');
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

const INCOME_WINDOW_MS = 6.9 * 24 * 60 * 60 * 1000; // just under Aster's 7-day-per-call cap
const INCOME_BATCH = 5;

/**
 * Realized PnL history for our agent's account via GET /fapi/v3/income
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
export async function getAsterIncomeHistory(sinceMs: number): Promise<AsterIncomeEntry[]> {
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
        const res = await fetch(`/api/aster-signed/fapi/v3/income?incomeType=REALIZED_PNL&startTime=${start}&endTime=${end}&limit=1000`);
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
// one symbol per call. Now that the symbol list is the full live exchange
// (500+ pairs, not a hand-picked 20), firing all of them at once with
// Promise.all would mean 500+ simultaneous requests to Aster's real API —
// risking their rate limit (x-mbx-used-weight-1m) for every user of this
// site. Fetch in small concurrent batches instead so the request rate stays
// reasonable regardless of how many symbols Aster lists.
const OI_BATCH_SIZE = 15;

export async function getAsterOpenInterest(symbols: string[], prices: Record<string, number>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (let i = 0; i < symbols.length; i += OI_BATCH_SIZE) {
    const batch = symbols.slice(i, i + OI_BATCH_SIZE);
    await Promise.all(batch.map(async sym => {
      try {
        const res = await fetch(`/api/aster-fapi/fapi/v1/openInterest?symbol=${sym}USDT`);
        const d = await res.json();
        out[sym] = parseFloat(d.openInterest ?? 0) * (prices[sym] || 0);
      } catch { /* skip symbol */ }
    }));
  }
  return out;
}
