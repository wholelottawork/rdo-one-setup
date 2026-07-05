import type { Metadata } from 'next';
import { AppProviders } from '@/lib/providers';
import './news/news.css';

export const metadata: Metadata = {
  title: 'RDO ONE — News',
};

export default function NewsGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
