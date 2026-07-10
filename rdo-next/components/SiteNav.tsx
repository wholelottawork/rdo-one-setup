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
    <nav id="rdo-nav">
      <div className="nav-logo">RDO<span>ONE</span></div>
      <div className="nav-div" />
      {links.map(l => (
        <Link key={l.page} href={l.href} className={activePage === l.page ? 'active' : ''}>{l.label}</Link>
      ))}
      <div style={{ marginLeft: 'auto' }} />

      <WalletControls />

      <div id="toastWrap" className="toast-wrap"></div>
    </nav>
  );
}
