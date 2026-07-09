'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation, type Lang } from '@/lib/i18n';

// Shared site nav — verbatim #rdo-nav markup (originally copy-pasted across
// markets/news/portfolio/transfer.html), inline styles included. Only the
// hrefs changed: /markets.html → /markets etc.
type PageKey = 'trade' | 'markets' | 'news' | 'portfolio' | 'transfer' | 'swap';

const LANG_BTN_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: 28, height: 28, background: 'transparent',
  border: '1px solid var(--border)', borderRadius: 4,
  color: 'var(--text3)', cursor: 'pointer',
};

const LANG_DD_STYLE: CSSProperties = {
  position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 900,
  background: 'var(--bg2,#1b2429)', border: '1px solid var(--border,#273035)',
  borderRadius: 4, padding: '4px 0', minWidth: 110,
  boxShadow: '0 8px 24px rgba(0,0,0,.5)',
};

const LANG_OPT_STYLE: CSSProperties = {
  display: 'block', width: '100%', padding: '7px 14px', border: 'none',
  background: 'transparent', color: 'var(--text3,#878c8f)', fontSize: 12,
  textAlign: 'left', cursor: 'pointer',
};

export function RdoNav({ active }: { active: PageKey }) {
  const { t, lang, setLang } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.lang-wrap')) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);

  const links: Array<[PageKey, string, string]> = [
    ['trade', '/', t('trade')],
    ['markets', '/markets', t('markets')],
    ['news', '/news', t('news')],
    ['portfolio', '/portfolio', t('portfolio')],
    ['transfer', '/transfer', t('transfer')],
    ['swap', '/swap', t('swap')],
  ];

  return (
    <nav id="rdo-nav">
      <div className="nav-logo">RDO<span>ONE</span></div>
      <div className="nav-div"></div>
      {links.map(([key, href, label]) => (
        <a key={key} href={href} className={key === active ? 'active' : undefined}>{label}</a>
      ))}
      <div style={{ marginLeft: 'auto' }}></div>
      <div className="lang-wrap" style={{ position: 'relative' }}>
        <button className="lang-btn" id="langBtn" aria-label="Language" style={LANG_BTN_STYLE} onClick={() => setOpen(o => !o)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><ellipse cx="12" cy="12" rx="4" ry="10" /><path d="M2 12h20" /></svg>
        </button>
        <div className="lang-dropdown" id="langDropdown" style={{ ...LANG_DD_STYLE, display: open ? undefined : 'none' }}>
          {(['en', 'ru', 'zh'] as Lang[]).map(l => (
            <button
              key={l}
              className="lang-option"
              style={{ ...LANG_OPT_STYLE, color: lang === l ? 'var(--accent,#50d2c1)' : undefined }}
              onClick={() => { setLang(l); setOpen(false); }}
            >
              {l === 'en' ? 'English' : l === 'ru' ? 'Русский' : '中文'}
            </button>
          ))}
        </div>
      </div>
    </nav>
  );
}
