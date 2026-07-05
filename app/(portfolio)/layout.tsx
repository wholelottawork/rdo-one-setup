import type { Metadata } from 'next';
import { AppProviders } from '@/lib/providers';
import './portfolio/portfolio.css';

export const metadata: Metadata = {
  title: 'RDO ONE — Portfolio',
};

export default function PortfolioGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
