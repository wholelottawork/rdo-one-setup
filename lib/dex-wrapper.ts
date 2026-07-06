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

export async function getBook(mode: TradeMode, symbol: string): Promise<OrderBook> {
  try {
    if (mode === 'aster') {
      const { getAsterBook } = await import('./aster');
      return await getAsterBook(symbol);
    }
    const { getL2Book } = await import('./hyperliquid');
    return await getL2Book(symbol);
  } catch {
    return { asks: [], bids: [] };
  }
}

export async function getCandles(mode: TradeMode, symbol: string, intervalMinutes: number): Promise<Candle[]> {
  try {
    if (mode === 'aster') {
      const { getAsterCandles } = await import('./aster');
      return await getAsterCandles(symbol, intervalMinutes, 200);
    }
    const { getCandles: getHLCandles } = await import('./hyperliquid');
    return await getHLCandles(symbol, intervalMinutes, 200);
  } catch {
    return [];
  }
}

export async function getFundingRates(mode: TradeMode): Promise<Record<string, number>> {
  try {
    if (mode === 'aster') {
      const { getAsterFunding } = await import('./aster');
      return await getAsterFunding();
    }
    const { getMetaAndAssetCtxs } = await import('./hyperliquid');
    const map = await getMetaAndAssetCtxs();
    if (!map) return {};
    const out: Record<string, number> = {};
    map.forEach((ctx, symbol) => {
      out[symbol] = ctx.funding * 100;
    });
    return out;
  } catch {
    return {};
  }
}
