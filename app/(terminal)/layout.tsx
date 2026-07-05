import type { Metadata } from 'next';
import { AppProviders } from '@/lib/providers';
import './terminal.css';

export const metadata: Metadata = {
  title: 'RDO ONE — Perpetuals Terminal',
};

// Root layout for the terminal route group. Each page group has its own root
// layout + verbatim original stylesheet — navigation between groups is a full
// page load, exactly like the original multi-page Vite site.
export default function TerminalLayout({ children }: { children: React.ReactNode }) {
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
