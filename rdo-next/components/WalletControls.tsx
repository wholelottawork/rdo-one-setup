'use client';

import { useEffect, useRef, useState } from 'react';
import { t, setLang, getLang } from '@/lib/i18n';
import { useWallet, EVM_NETWORKS, type EvmNetworkOption } from '@/lib/wallet';
import { NetworkSwitcher } from './NetworkSwitcher';
import { WalletDropdown } from './WalletDropdown';

/**
 * The one control cluster — network switcher, language picker, wallet
 * connect button — used identically on every page (SiteNav's pages and
 * the trade page's own header alike), so there's exactly one visual
 * design and one behavior for all three, not per-page reimplementations
 * that can drift (a language picker missing on one page, a wallet button
 * styled differently on another, etc).
 */
export function WalletControls() {
  const { evmAddress, solAddress } = useWallet();
  const [lang, setLangState] = useState('en');
  const [langOpen, setLangOpen] = useState(false);
  const [activeNetwork, setActiveNetwork] = useState<EvmNetworkOption>(EVM_NETWORKS[1]); // Ethereum until detected otherwise
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setLangState(getLang()); }, []);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (langOpen && langRef.current && !langRef.current.contains(e.target as Node)) setLangOpen(false);
    }
    document.addEventListener('click', onOutsideClick);
    return () => document.removeEventListener('click', onOutsideClick);
  }, [langOpen]);

  const displayAddress = activeNetwork.chainId === 'solana' ? solAddress : evmAddress;

  return (
    <>
      <NetworkSwitcher onChange={setActiveNetwork} />

      <div className="lang-wrap" ref={langRef}>
        <button className="lang-btn" onClick={() => setLangOpen(o => !o)} aria-label="Language">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><ellipse cx="12" cy="12" rx="4" ry="10" /><path d="M2 12h20" /></svg>
        </button>
        {langOpen && (
          <div className="lang-dropdown">
            {(['en', 'ru', 'zh'] as const).map(l => (
              <button key={l} className={`lang-option${lang === l ? ' active' : ''}`} onClick={() => { setLang(l); setLangState(l); setLangOpen(false); }}>
                {l === 'en' ? 'English' : l === 'ru' ? 'Русский' : '中文'}
              </button>
            ))}
          </div>
        )}
      </div>

      <WalletDropdown address={displayAddress} connectLabel={t('connect')} />
    </>
  );
}
