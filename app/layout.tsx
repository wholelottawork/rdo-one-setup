import type { Metadata } from 'next';
import { AppProviders } from '@/lib/providers';
import { HLSocketProvider } from '@/lib/hl-socket';
import './terminal.css';

export const metadata: Metadata = {
  title: 'RDO ONE — Perpetuals Terminal',
};

/** Single root layout shared by ALL pages.
 *  Providers mount once and persist across client-side navigations. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AppProviders>
          <HLSocketProvider network="mainnet">
            {children}
          </HLSocketProvider>
        </AppProviders>
      </body>
    </html>
  );
}
