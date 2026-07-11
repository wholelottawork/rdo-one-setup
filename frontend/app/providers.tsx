'use client';

import { QueryClientProvider } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/query';

/**
 * Mounts the shared React Query client for the whole app so components can use
 * useQuery hooks, and imperative code (via cachedFetch) shares the same cache.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={getQueryClient()}>
      {children}
    </QueryClientProvider>
  );
}
