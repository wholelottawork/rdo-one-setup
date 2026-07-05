import type { Candle, OrderBook } from './hyperliquid';

export interface AsterTicker {
  symbol: string;
  lastPrice: number;
  openPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
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

// Open interest per symbol (USD notional) — ported from main.js fetchAsterOI()
export async function getAsterOpenInterest(symbols: string[], prices: Record<string, number>): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  await Promise.all(symbols.map(async sym => {
    try {
      const res = await fetch(`/api/aster-fapi/fapi/v1/openInterest?symbol=${sym}USDT`);
      const d = await res.json();
      out[sym] = parseFloat(d.openInterest ?? 0) * (prices[sym] || 0);
    } catch { /* skip symbol */ }
  }));
  return out;
}
