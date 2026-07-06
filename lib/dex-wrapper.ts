export type TradeMode = 'hl' | 'aster';

export interface UnifiedMarket {
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  fundingRate8h: number;
  openInterest: number;
  maxLeverage: number;
}

export interface Signer {
  signTypedData(domain: unknown, types: unknown, value: unknown): Promise<string>;
}

export interface OrderParams {
  symbol: string;
  sizeDollars: number;
  leverage: number;
  isLong: boolean;
  signer: Signer;
}

export interface CloseParams {
  symbol: string;
  size: number;
  isLong: boolean;
  signer: Signer;
}

export interface CancelParams {
  oid: number;
  symbol: string;
  signer: Signer;
}

export type { Candle, OrderBook, Position, Fill, OpenOrder } from './hyperliquid';

export async function getMarkets(mode: TradeMode): Promise<UnifiedMarket[]> {
  try {
    if (mode === 'aster') {
      const { getAsterTickers } = await import('./aster');
      const tickers = await getAsterTickers();
      if (!Array.isArray(tickers)) return [];
      return tickers.map(t => ({
        symbol: t.symbol,
        price: t.lastPrice,
        priceChange24h: t.priceChangePercent,
        volume24h: t.quoteVolume,
        // Aster: funding/OI fetched separately; maxLeverage is 200x per Aster docs
        fundingRate8h: 0,
        openInterest: 0,
        maxLeverage: 200,
      }));
    }

    const { getHLTickers } = await import('./hyperliquid');
    const tickers = await getHLTickers();
    if (!tickers || typeof tickers !== 'object') return [];
    return Object.entries(tickers).map(([symbol, t]) => ({
      symbol,
      price: t.price,
      priceChange24h: t.chgPct,
      volume24h: t.vol,
      fundingRate8h: t.fund8h,
      openInterest: t.oi,
      maxLeverage: t.lev,
    }));
  } catch {
    return [];
  }
}
