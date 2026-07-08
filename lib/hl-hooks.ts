'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getMetaAndAssetCtxs, getPositions, getUserFills, getOpenOrders,
  getFundingHistory, getCandles, getL2Book, loadBalance, getHLTickers,
  type Candle, type HLNetwork,
} from './hyperliquid';

export function useHLMeta(network: HLNetwork = 'mainnet') {
  return useQuery({
    queryKey: ['hl', 'meta', network],
    queryFn: () => getMetaAndAssetCtxs(network),
    refetchInterval: 10_000,
  });
}

export function useHLTickers(network: HLNetwork = 'mainnet') {
  return useQuery({
    queryKey: ['hl', 'tickers', network],
    queryFn: () => getHLTickers(network),
    refetchInterval: 5_000,
  });
}

export function useHLCandles(symbol: string, intervalMinutes: number, network: HLNetwork = 'mainnet') {
  return useQuery<Candle[]>({
    queryKey: ['hl', 'candles', symbol, intervalMinutes, network],
    queryFn: () => getCandles(symbol, intervalMinutes, 200, network),
  });
}

export function useHLBook(symbol: string, network: HLNetwork = 'mainnet') {
  return useQuery({
    queryKey: ['hl', 'book', symbol, network],
    queryFn: () => getL2Book(symbol, network),
    refetchInterval: 3_000,
  });
}

export function useHLBalance(address: string | null, network: HLNetwork = 'mainnet') {
  return useQuery({
    queryKey: ['hl', 'balance', address, network],
    queryFn: () => loadBalance(address!, network),
    enabled: !!address,
    refetchInterval: 15_000,
  });
}

export function useHLPositions(address: string | null, network: HLNetwork = 'mainnet') {
  return useQuery({
    queryKey: ['hl', 'positions', address, network],
    queryFn: () => getPositions(address!, network),
    enabled: !!address,
    refetchInterval: 15_000,
  });
}

export function useHLFills(address: string | null, enabled: boolean, network: HLNetwork = 'mainnet') {
  return useQuery({
    queryKey: ['hl', 'fills', address, network],
    queryFn: () => getUserFills(address!, network),
    enabled: !!address && enabled,
  });
}

export function useHLOpenOrders(address: string | null, enabled: boolean, network: HLNetwork = 'mainnet') {
  return useQuery({
    queryKey: ['hl', 'openOrders', address, network],
    queryFn: () => getOpenOrders(address!, network),
    enabled: !!address && enabled,
  });
}

export function useHLFunding(address: string | null, enabled: boolean, network: HLNetwork = 'mainnet') {
  return useQuery({
    queryKey: ['hl', 'funding', address, network],
    queryFn: () => getFundingHistory(address!, network),
    enabled: !!address && enabled,
  });
}
