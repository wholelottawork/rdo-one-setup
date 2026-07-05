import type { Metadata } from 'next';
import { AppProviders } from '@/lib/providers';
import './markets/markets.css';

export const metadata: Metadata = {
  title: 'RDO ONE — Markets',
};

export default function MarketsGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
