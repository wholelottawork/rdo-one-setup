import type { Metadata } from 'next';
import { AppProviders } from '@/lib/providers';
import { HLSocketProvider } from '@/lib/hl-socket';
import { AsterSocketProvider } from '@/lib/aster-socket';
import { ShellProvider } from '@/app/_components/ShellContext';
import { ShellWrapper } from '@/app/_components/ShellWrapper';
import './terminal.css';

export const metadata: Metadata = {
  title: 'RDO ONE — Perpetuals Terminal',
};

/** Single root layout shared by ALL pages.
 *  ShellProvider + ShellWrapper mount once and persist across navigations,
 *  so header stats, market selection, mode, network, and bottom panel
 *  state are all preserved when switching pages. */
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
            <AsterSocketProvider>
              <ShellProvider>
                <ShellWrapper>
                  {children}
                </ShellWrapper>
              </ShellProvider>
            </AsterSocketProvider>
          </HLSocketProvider>
        </AppProviders>
      </body>
    </html>
  );
}
