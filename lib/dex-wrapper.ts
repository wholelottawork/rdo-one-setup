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

import type { Candle, OrderBook } from './hyperliquid';
export type { Candle, OrderBook, Position, Fill, OpenOrder } from './hyperliquid';

export async function getMarkets(mode: TradeMode): Promise<UnifiedMarket[]> {
  try {
    if (mode === 'aster') {
      const { getAsterTickers } = await import('./aster');
      const tickers = await getAsterTickers();
      return tickers.map(t => ({
        symbol: t.symbol,
        price: t.lastPrice,
        priceChange24h: t.priceChangePercent,
        volume24h: t.quoteVolume,
        fundingRate8h: 0,
        openInterest: 0,
        maxLeverage: 200,
      }));
    }

    const { getHLTickers } = await import('./hyperliquid');
    const tickers = await getHLTickers();
    return Object.entries(tickers).map(([symbol, t]) => ({
      symbol,
      price: t.price,
      priceChange24h: t.chgPct,
      volume24h: t.vol,
      fundingRate8h: t.fund8h,
      openInterest: t.oi,
      maxLeverage: t.lev,
    }));
  } catch (e) {
    console.error('getMarkets failed', { mode }, e);
    return [];
  }
}

export async function getBook(mode: TradeMode, symbol: string): Promise<OrderBook> {
  try {
    if (mode === 'aster') {
      const { getAsterBook } = await import('./aster');
      return await getAsterBook(symbol);
    }
    const { getL2Book } = await import('./hyperliquid');
    return await getL2Book(symbol);
  } catch (e) {
    console.error('getBook failed', { mode, symbol }, e);
    return { asks: [], bids: [] };
  }
}

export async function getCandles(mode: TradeMode, symbol: string, intervalMinutes: number, count = 200): Promise<Candle[]> {
  try {
    if (mode === 'aster') {
      const { getAsterCandles } = await import('./aster');
      return await getAsterCandles(symbol, intervalMinutes, count);
    }
    const { getCandles: getHLCandles } = await import('./hyperliquid');
    return await getHLCandles(symbol, intervalMinutes, count);
  } catch (e) {
    console.error('getCandles failed', { mode, symbol, intervalMinutes, count }, e);
    return [];
  }
}

export async function getFundingRates(mode: TradeMode): Promise<Record<string, number>> {
  try {
    if (mode === 'aster') {
      const { getAsterFunding } = await import('./aster');
      return await getAsterFunding(); // already scaled by 100 (percentage)
    }
    const { getMetaAndAssetCtxs } = await import('./hyperliquid');
    const map = await getMetaAndAssetCtxs();
    if (!map) return {};
    const out: Record<string, number> = {};
    map.forEach((ctx, symbol) => {
      out[symbol] = ctx.funding * 100; // scale to percentage
    });
    return out; // both branches return funding rates as percentages (already scaled by 100)
  } catch (e) {
    console.error('getFundingRates failed', { mode }, e);
    return {};
  }
}
