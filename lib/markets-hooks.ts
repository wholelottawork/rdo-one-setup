'use client';

import { useQuery } from '@tanstack/react-query';
import { cgGlobal, cgTrending, cgCoinsMarkets } from './coingecko';
import { binanceTicker24hr, binanceKlines } from './binance';
import { getFearGreed } from './feargreed';

export const TICKER_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT',
  'LINKUSDT', 'DOTUSDT', 'POLUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT', 'APTUSDT',
  'ARBUSDT', 'OPUSDT', 'INJUSDT', 'SUIUSDT', 'TIAUSDT', 'JUPUSDT', 'WIFUSDT', 'BONKUSDT', 'PEPEUSDT',
];

export function useBinanceTicker() {
  return useQuery({
    queryKey: ['binance', 'ticker24hr'],
    queryFn: () => binanceTicker24hr(TICKER_SYMBOLS),
    refetchInterval: 30_000,
  });
}

export function useBtcKlines() {
  return useQuery({
    queryKey: ['binance', 'klines', 'BTCUSDT', '4h'],
    queryFn: () => binanceKlines('BTCUSDT', '4h', 42),
    refetchInterval: 120_000,
  });
}

export function useCgGlobal() {
  return useQuery({
    queryKey: ['coingecko', 'global'],
    queryFn: cgGlobal,
    refetchInterval: 120_000,
  });
}

export function useCgTrending() {
  return useQuery({
    queryKey: ['coingecko', 'trending'],
    queryFn: cgTrending,
    refetchInterval: 120_000,
  });
}

export function useCgCoinsMarkets() {
  return useQuery({
    queryKey: ['coingecko', 'coinsMarkets'],
    queryFn: cgCoinsMarkets,
    refetchInterval: 90_000,
  });
}

export function useFearGreed() {
  return useQuery({
    queryKey: ['feargreed'],
    queryFn: getFearGreed,
    refetchInterval: 300_000,
  });
}
