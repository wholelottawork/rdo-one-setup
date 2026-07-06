'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getMarkets, getBook, getCandles, getFundingRates,
  type TradeMode, type Candle, type OrderBook,
} from './dex-wrapper';

export function useMarkets(mode: TradeMode) {
  return useQuery({
    queryKey: ['dex', 'markets', mode],
    queryFn: () => getMarkets(mode),
    refetchInterval: 5_000,
  });
}

export function useBook(mode: TradeMode, symbol: string, enabled = true) {
  return useQuery({
    queryKey: ['dex', 'book', mode, symbol],
    queryFn: () => getBook(mode, symbol),
    refetchInterval: mode === 'aster' ? 2_000 : 3_000,
    enabled,
  });
}

export function useCandles(mode: TradeMode, symbol: string, intervalMinutes: number) {
  return useQuery<Candle[]>({
    queryKey: ['dex', 'candles', mode, symbol, intervalMinutes],
    queryFn: () => getCandles(mode, symbol, intervalMinutes),
  });
}

export function useFundingRates(mode: TradeMode) {
  return useQuery({
    queryKey: ['dex', 'funding', mode],
    queryFn: () => getFundingRates(mode),
    refetchInterval: 30_000,
  });
}
