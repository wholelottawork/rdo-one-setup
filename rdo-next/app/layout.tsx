import type { Metadata } from 'next';
import './globals.css';
import './subpage.css';

export const metadata: Metadata = {
  title: 'RDO ONE — Perpetuals Terminal',
  description: 'Dual-exchange perpetuals terminal — BASIC (Hyperliquid) + EXTRA (Aster DEX)',
};

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
      <body>{children}</body>
    </html>
  );
}
