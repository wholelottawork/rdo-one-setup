// Shared component — used by pages: Markets, News, Portfolio, Transfer.
'use client';

import Link from 'next/link';
import { t } from '@/lib/i18n';
import { WalletControls } from './WalletControls';

/**
 * The one shared nav — logo, page links, and the unified control cluster
 * (network switcher + language picker + wallet connect), matching
 * Aster's own site: one connect action covers EVM + Solana together (see
 * lib/wallet.tsx's WalletProvider), shown once here instead of every
 * page asking to connect its own wallet.
 */
export function SiteNav({ activePage }: { activePage: 'trade' | 'markets' | 'news' | 'portfolio' | 'transfer' }) {
  const links: Array<{ href: string; label: string; page: typeof activePage }> = [
    { href: '/', label: t('trade'), page: 'trade' },
    { href: '/markets', label: t('markets'), page: 'markets' },
    { href: '/news', label: t('news'), page: 'news' },
    { href: '/portfolio', label: t('portfolio'), page: 'portfolio' },
    { href: '/transfer', label: t('transfer'), page: 'transfer' },
  ];

  return (
    <nav id="rdo-nav" className="fixed top-0 left-0 right-0 h-10 bg-black border-b border-[#1f1f1f] flex items-center gap-2 px-6 z-[1000]">
      <div className="text-[13px] font-extrabold tracking-wide text-[#f5f1ea] flex-shrink-0">RDO<span className="text-[#50d2c1]">ONE</span></div>
      <div className="w-px h-[18px] bg-[#1f1f1f] mx-1 flex-shrink-0" />
      {links.map(l => (
        <Link
          key={l.page}
          href={l.href}
          className={
            'text-xs font-medium text-[#878c8f] py-[5px] px-3 rounded-[7px] transition-colors duration-150 flex-shrink-0 no-underline hover:text-white hover:bg-[#1a1a1a] ' +
            (activePage === l.page ? 'text-white bg-[#1f1f1f] font-semibold' : '')
          }
        >
          {l.label}
        </Link>
      ))}
      <div className="ml-auto" />

      <WalletControls />

      <div id="toastWrap" className="toast-wrap" />
    </nav>
  );
}
