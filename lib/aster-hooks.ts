'use client';

import { useQuery } from '@tanstack/react-query';
import { getAsterTickers, getAsterFunding, getAsterCandles, getAsterBook, getAsterOpenInterest } from './aster';

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
    queryKey: ['aster', 'oi'],
    queryFn: () => getAsterOpenInterest(symbols, prices),
    refetchInterval: 30_000,
    enabled: enabled && Object.keys(prices).length > 0,
  });
}
