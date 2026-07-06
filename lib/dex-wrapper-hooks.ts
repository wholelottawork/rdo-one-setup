'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getMarkets, getBook, getCandles, getFundingRates,
  getBalance, getPositions, getFills, getOpenOrders,
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
    enabled: !!symbol && enabled,
  });
}

export function useCandles(mode: TradeMode, symbol: string, intervalMinutes: number) {
  return useQuery({
    queryKey: ['dex', 'candles', mode, symbol, intervalMinutes],
    queryFn: () => getCandles(mode, symbol, intervalMinutes),
    // Refresh candles every 60s to catch new closed bars
    refetchInterval: 60_000,
  });
}

export function useFundingRates(mode: TradeMode) {
  return useQuery({
    queryKey: ['dex', 'funding', mode],
    queryFn: () => getFundingRates(mode),
    refetchInterval: 30_000,
  });
}

export function useBalance(mode: TradeMode, address: string | null) {
  return useQuery({
    queryKey: ['dex', 'balance', mode, address],
    queryFn: () => getBalance(mode, address!),
    enabled: !!address && mode === 'hl',
    refetchInterval: 15_000,
  });
}

export function usePositions(mode: TradeMode, address: string | null) {
  return useQuery({
    queryKey: ['dex', 'positions', mode, address],
    queryFn: () => getPositions(mode, address!),
    enabled: !!address && mode === 'hl',
    refetchInterval: 15_000,
  });
}

export function useFills(mode: TradeMode, address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['dex', 'fills', mode, address],
    queryFn: () => getFills(mode, address!),
    enabled: !!address && enabled && mode === 'hl',
  });
}

export function useOpenOrders(mode: TradeMode, address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['dex', 'openOrders', mode, address],
    queryFn: () => getOpenOrders(mode, address!),
    enabled: !!address && enabled && mode === 'hl',
  });
}
