'use client';

import { useQuery } from '@tanstack/react-query';
import { getAsterTickers, getAsterFunding, getAsterCandles, getAsterBook, getAsterOpenInterest, getAsterSymbols, getAsterLeverageBrackets } from './aster';

// The exchange's own symbol list — rarely changes, so a long staleTime avoids
// re-fetching exchangeInfo (a ~700KB payload) more often than needed.
export function useAsterSymbols() {
  return useQuery({
    queryKey: ['aster', 'symbols'],
    queryFn: getAsterSymbols,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}

export function useAsterTickers() {
  return useQuery({
    queryKey: ['aster', 'tickers'],
    queryFn: getAsterTickers,
    refetchInterval: 5_000,
  });
}

export function useAsterFunding() {
  return useQuery({
    queryKey: ['aster', 'funding'],
    queryFn: getAsterFunding,
    refetchInterval: 30_000,
  });
}

export function useAsterCandles(symbol: string, intervalMinutes: number) {
  return useQuery({
    queryKey: ['aster', 'candles', symbol, intervalMinutes],
    queryFn: () => getAsterCandles(symbol, intervalMinutes, 200),
  });
}

export function useAsterBook(symbol: string, enabled = true) {
  return useQuery({
    queryKey: ['aster', 'book', symbol],
    queryFn: () => getAsterBook(symbol),
    refetchInterval: 2_000,
    enabled,
  });
}

export function useAsterOpenInterest(symbols: string[], prices: Record<string, number>, enabled = true) {
  return useQuery({
    queryKey: ['aster', 'oi', symbols.length],
    queryFn: () => getAsterOpenInterest(symbols, prices),
    // Batched (see getAsterOpenInterest) but still N requests for N symbols —
    // slower interval than the bulk ticker/funding calls on purpose.
    refetchInterval: 90_000,
    enabled: enabled && symbols.length > 0 && Object.keys(prices).length > 0,
  });
}

// One signed call for every symbol's real max leverage — backed by a 5-min
// server-side cache (see server/routes/proxy.js), so this is cheap to refetch.
export function useAsterLeverageBrackets() {
  return useQuery({
    queryKey: ['aster', 'leverageBrackets'],
    queryFn: getAsterLeverageBrackets,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
  });
}
