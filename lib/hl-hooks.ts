'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getMetaAndAssetCtxs, getPositions, getUserFills, getOpenOrders,
  getFundingHistory, getCandles, getL2Book, loadBalance, getHLTickers,
  type Candle,
} from './hyperliquid';

export function useHLMeta() {
  return useQuery({
    queryKey: ['hl', 'meta'],
    queryFn: getMetaAndAssetCtxs,
    refetchInterval: 10_000,
  });
}

export function useHLTickers() {
  return useQuery({
    queryKey: ['hl', 'tickers'],
    queryFn: getHLTickers,
    refetchInterval: 5_000,
  });
}

export function useHLCandles(symbol: string, intervalMinutes: number) {
  return useQuery<Candle[]>({
    queryKey: ['hl', 'candles', symbol, intervalMinutes],
    queryFn: () => getCandles(symbol, intervalMinutes, 200),
  });
}

export function useHLBook(symbol: string) {
  return useQuery({
    queryKey: ['hl', 'book', symbol],
    queryFn: () => getL2Book(symbol),
    refetchInterval: 3_000,
  });
}

export function useHLBalance(address: string | null) {
  return useQuery({
    queryKey: ['hl', 'balance', address],
    queryFn: () => loadBalance(address!),
    enabled: !!address,
    refetchInterval: 15_000,
  });
}

export function useHLPositions(address: string | null) {
  return useQuery({
    queryKey: ['hl', 'positions', address],
    queryFn: () => getPositions(address!),
    enabled: !!address,
    refetchInterval: 15_000,
  });
}

export function useHLFills(address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['hl', 'fills', address],
    queryFn: () => getUserFills(address!),
    enabled: !!address && enabled,
  });
}

export function useHLOpenOrders(address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['hl', 'openOrders', address],
    queryFn: () => getOpenOrders(address!),
    enabled: !!address && enabled,
  });
}

export function useHLFunding(address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['hl', 'funding', address],
    queryFn: () => getFundingHistory(address!),
    enabled: !!address && enabled,
  });
}
