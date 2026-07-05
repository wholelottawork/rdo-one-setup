'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation, type Lang } from '@/lib/i18n';
import { useWallet } from '@/lib/wallet';
import { fmtPrice, fmtAster, fmtLarge, type TradeMode } from '@/lib/markets';

export interface DropdownRow {
  sym: string;
  lev: string;
  price: string;
  chgPct: number | null;
  fund8h: number | null;
  vol: number | null;
  oi: number | null;
}

export interface HeaderStats {
  mark: string;
  change: string;
  changeUp: boolean;
  volume: string;
  funding: string;
}

interface Props {
  mode: TradeMode;
  market: string;
  stats: HeaderStats;
  balance: number;
  dropdownRows: DropdownRow[];
  onModeChange: (mode: TradeMode) => void;
  onSelectMarket: (sym: string) => void;
  onOpenDeposit: () => void;
}

const fmtFund = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(4)}%`);
const fmtChg = (v: number | null) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`);

export function Header({ mode, market, stats, balance, dropdownRows, onModeChange, onSelectMarket, onOpenDeposit }: Props) {
  const { t, lang, setLang } = useTranslation();
  const { address, connect } = useWallet();
  const [popupOpen, setPopupOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mktBtnRef = useRef<HTMLButtonElement>(null);

  const isAster = mode === 'aster';
  const suffix = isAster ? '-USDT' : '-USDC';

  // Close dropdown on outside click — mirrors bindMarketBtn() in main.js
  useEffect(() => {
    if (!dropdownOpen) return;
    const close = (e: MouseEvent) => {
      if (!dropdownRef.current?.contains(e.target as Node) && e.target !== mktBtnRef.current) {
        setDropdownOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [dropdownOpen]);

  // Close lang dropdown on outside click — mirrors initLang()
  useEffect(() => {
    if (!langOpen) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.lang-wrap')) setLangOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [langOpen]);

  const filtered = dropdownRows.filter(r => r.sym.toLowerCase().includes(query.toLowerCase()));

  return (
    <header className="hdr">
      <div className="hdr-left">
        <div className="hdr-logo">
          <span className="logo-rdo">RDO</span><span className="logo-one">ONE</span>
        </div>
        <div className="hdr-div"></div>

        {/* ── MODE SWITCHER ── */}
        <div className="mode-switch-wrap">
          <div className="mode-switch" id="modeSwitch">
            <button className={`mode-btn mode-hl${!isAster ? ' active' : ''}`} id="modeBtnHL" onClick={() => onModeChange('hl')}>BASIC</button>
            <button className={`mode-btn mode-aster${isAster ? ' active' : ''}`} id="modeBtnAster" onClick={() => onModeChange('aster')}>EXTRA</button>
          </div>
          <button className="mode-help-btn" id="modeHelpBtn" onClick={() => setPopupOpen(o => !o)}>?</button>

          {/* backdrop for mode popup */}
          <div className={`mode-backdrop${popupOpen ? '' : ' hidden'}`} id="modeBackdrop" onClick={() => setPopupOpen(false)}></div>

          {/* mode info popup */}
          <div className={`mode-popup${popupOpen ? '' : ' hidden'}`} id="modePopup">
            <div className="mode-popup-row">
              <span className="mode-popup-tag basic">BASIC</span>
              <div className="mode-popup-info">
                <strong>{t('basicTitle')}</strong><br />
                <b>{t('basicLev')}</b><br />
                <span>{t('basicDesc')}</span><br />
                <span>{t('basicFee')}</span><br />
                <span>{t('basicExtra')}</span>
              </div>
            </div>
            <div className="mode-popup-divider"></div>
            <div className="mode-popup-row">
              <span className="mode-popup-tag extra">EXTRA</span>
              <div className="mode-popup-info">
                <strong>{t('extraTitle')}</strong><br />
                <b>{t('extraLev')}</b><br />
                <span>{t('extraDesc')}</span><br />
                <span>{t('extraFee')}</span><br />
                <span>{t('extraExtra')}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="hdr-div"></div>

        <nav className="hdr-nav">
          <a className="hdr-nav-link active" href="/">{t('trade')}</a>
          <a className="hdr-nav-link" href="/markets">{t('markets')}</a>
          <a className="hdr-nav-link" href="/news">{t('news')}</a>
          <a className="hdr-nav-link" href="/portfolio">{t('portfolio')}</a>
          <a className="hdr-nav-link" href="/transfer">{t('transfer')}</a>
          <a className="hdr-nav-link" href="/swap">{t('swap')}</a>
        </nav>

        <div className="hdr-div"></div>

        <button
          className="mkt-btn"
          id="mktBtn"
          ref={mktBtnRef}
          onClick={e => {
            e.stopPropagation();
            setDropdownOpen(o => !o);
            setPopupOpen(false);
            setTimeout(() => searchRef.current?.focus(), 0);
          }}
        >
          <span id="mktSymbol">{market}{suffix}</span>
          <span className="mkt-arrow">▾</span>
        </button>

        {/* market dropdown */}
        <div id="mktDropdown" ref={dropdownRef} className={`mkt-dropdown mkt-wide${dropdownOpen ? '' : ' hidden'}`}>
          <input
            id="mktSearch"
            ref={searchRef}
            className="mkt-search"
            placeholder={t('searchMarket')}
            autoComplete="off"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onClick={e => e.stopPropagation()}
          />
          <div className="mkt-list" id="mktList">
            <div className="mkt-col-hdr">
              <span>{t('market')}</span><span>{t('lastPrice')}</span><span>{t('change24hShort')}</span><span>{t('funding8h')}</span><span>{t('volume')}</span><span>{t('openInterest')}</span>
            </div>
            {filtered.map(r => (
              <div
                key={r.sym}
                className="mkt-item mkt-item-wide"
                onClick={() => { onSelectMarket(r.sym); setDropdownOpen(false); setQuery(''); }}
              >
                <span className="mkt-item-name">{r.sym}{suffix}<span className="mkt-item-lev">{r.lev}</span></span>
                <span className="mkt-item-price">{r.price}</span>
                <span className={(r.chgPct ?? 0) >= 0 ? 'up' : 'dn'}>{fmtChg(r.chgPct)}</span>
                <span className={(r.fund8h ?? 0) >= 0 ? 'up' : 'dn'}>{fmtFund(r.fund8h)}</span>
                <span>{r.vol != null ? '$' + fmtLarge(r.vol) : '—'}</span>
                <span>{r.oi != null ? '$' + fmtLarge(r.oi) : '—'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="hdr-stats">
        <div className="hdr-stat">
          <span className="hdr-stat-label">{t('mark')}</span>
          <span className="hdr-stat-val" id="statMark">{stats.mark}</span>
        </div>
        <div className="hdr-stat">
          <span className="hdr-stat-label">{t('change24h')}</span>
          <span className={`hdr-stat-val ${stats.changeUp ? 'up' : 'down'}`} id="statChange">{stats.change}</span>
        </div>
        <div className="hdr-stat">
          <span className="hdr-stat-label">{t('volume24h')}</span>
          <span className="hdr-stat-val" id="statVolume">{stats.volume}</span>
        </div>
        <div className="hdr-stat">
          <span className="hdr-stat-label">{t('fundingCountdown')}</span>
          <span className="hdr-stat-val" id="statFunding">{stats.funding}</span>
        </div>
      </div>

      <div className="hdr-right">
        <span id="balanceDisplay" className={`hdr-balance${address ? '' : ' hidden'}`}>${balance.toFixed(2)}</span>
        <button id="depositBtn" className={`deposit-btn${address ? '' : ' hidden'}`} onClick={onOpenDeposit}>{t('deposit')}</button>
        <div className="lang-wrap">
          <button className="lang-btn" id="langBtn" onClick={() => setLangOpen(o => !o)} aria-label="Language">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><ellipse cx="12" cy="12" rx="4" ry="10" /><path d="M2 12h20" /></svg>
          </button>
          <div className={`lang-dropdown${langOpen ? '' : ' hidden'}`} id="langDropdown">
            {(['en', 'ru', 'zh'] as Lang[]).map(l => (
              <button
                key={l}
                className={`lang-option${lang === l ? ' active' : ''}`}
                onClick={() => { setLang(l); setLangOpen(false); }}
              >
                {l === 'en' ? 'English' : l === 'ru' ? 'Русский' : '中文'}
              </button>
            ))}
          </div>
        </div>
        <button
          id="walletBtn"
          className={`wallet-btn${address ? ' connected' : ''}`}
          onClick={() => { if (!address) connect(); }}
        >
          {address ? address.slice(0, 6) + '...' + address.slice(-4) : t('connect')}
        </button>
      </div>
    </header>
  );
}

// Builds a dropdown price cell exactly like renderMarketList()'s getPrice
export function dropdownPrice(isAster: boolean, price: number | undefined): string {
  if (!price) return '—';
  return isAster ? fmtAster(price) : fmtPrice(price);
}
