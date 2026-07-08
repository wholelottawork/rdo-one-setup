import type { Metadata } from 'next';
import { AppProviders } from '@/lib/providers';
import './portfolio/portfolio.css';
import '../(terminal)/terminal.css';

export const metadata: Metadata = {
  title: 'RDO ONE — Portfolio',
};

export default function PortfolioGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
