'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { I18nProvider } from './i18n';
import { ToastProvider } from './toast';
import { WalletProvider } from './wallet';

// One provider stack shared by every route group's root layout. Each page
// group is a separate root layout (MPA-style, like the original site), so
// this mounts fresh per page load.
export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: false,
      },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <WalletProvider>{children}</WalletProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
