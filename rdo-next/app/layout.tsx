import type { Metadata } from 'next';
import './globals.css';
import './subpage.css';
import { WalletProvider } from '@/lib/wallet';

export const metadata: Metadata = {
  title: 'RDO ONE — Perpetuals Terminal',
  description: 'Dual-exchange perpetuals terminal — BASIC (Hyperliquid) + EXTRA (Aster DEX)',
};

// WalletProvider mounts once here, so every route (terminal, markets, news,
// portfolio, transfer) shares one wallet Context instance via real React
// state across client-side navigations — not a per-page reconnect.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
