'use client';

import { useQuery } from '@tanstack/react-query';
import { loadSolanaPortfolio } from './solana';
import { loadArbitrumBalances } from './arbitrum';

export function useSolanaPortfolio(pubkey: string | null) {
  return useQuery({
    queryKey: ['solana', 'portfolio', pubkey],
    queryFn: () => loadSolanaPortfolio(pubkey!),
    enabled: !!pubkey,
    refetchInterval: 30_000,
  });
}

export function useArbitrumBalances(address: string | null) {
  return useQuery({
    queryKey: ['arbitrum', 'balances', address],
    queryFn: () => loadArbitrumBalances(address!),
    enabled: !!address,
    refetchInterval: 30_000,
  });
}
