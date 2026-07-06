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
