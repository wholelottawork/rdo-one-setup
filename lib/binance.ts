export interface BinanceTicker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
}

export async function binanceTicker24hr(symbols: string[]): Promise<BinanceTicker[]> {
  try {
    const param = encodeURIComponent(JSON.stringify(symbols));
    const res = await fetch(`/api/binance/api/v3/ticker/24hr?symbols=${param}`);
    const json = await res.json();
    if (!Array.isArray(json)) return [];
    return json.map((t: Record<string, string>) => ({
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      priceChangePercent: parseFloat(t.priceChangePercent),
    }));
  } catch {
    return [];
  }
}

export type Kline = [number, string, string, string, string, string, number, string, ...unknown[]];

export async function binanceKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  try {
    const res = await fetch(`/api/binance/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}
