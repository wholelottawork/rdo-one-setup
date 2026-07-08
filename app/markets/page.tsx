'use client';

import './markets.css';

import { useMemo, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import {
  TICKER_SYMBOLS, useBinanceTicker, useBtcKlines, useCgGlobal, useCgTrending,
  useCgCoinsMarkets, useFearGreed,
} from '@/lib/markets-hooks';
import { useHLTickers } from '@/lib/hl-hooks';
import { useAsterTickers, useAsterFunding, useAsterOpenInterest, useAsterSymbols, useAsterLeverageBrackets } from '@/lib/aster-hooks';
import { type TradeMode } from '@/lib/markets';
const LABEL: Record<string, string> = Object.fromEntries(TICKER_SYMBOLS.map(s => [s, s.replace('USDT', '')]));

function fmtLarge(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  return '$' + n.toLocaleString('en-US');
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 10000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  if (n >= 1000) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return '$' + n.toFixed(4);
  if (n >= 0.001) return '$' + n.toFixed(5);
  return '$' + n.toFixed(8);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
}

const pCls = (v: number | null | undefined) => ((v ?? 0) >= 0 ? 'up' : 'dn');

function fgColor(v: string | number): string {
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (n <= 25) return '#ed7088';
  if (n <= 45) return '#f97316';
  if (n <= 55) return '#eab308';
  if (n <= 75) return '#50d2c1';
  return '#1fa67d';
}

// ─── Sparkline — verbatim geometry from makeSpark() ──────────────────────────
function Spark({ rawPts, color, gid }: { rawPts: Array<[number, number]>; color: string; gid: string }) {
  const step = Math.max(1, Math.floor(rawPts.length / 40));
  const pts = rawPts.filter((_, i) => i % step === 0);
  if (pts.length < 2) return null;
  const vals = pts.map(p => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const rng = max - min || 1;
  const W = 120, H = 44;
  const px = (i: number) => (i / (pts.length - 1)) * W;
  const py = (v: number) => H - ((v - min) / rng) * H * 0.8 - H * 0.1;
  const linePts = pts.map((p, i) => `${px(i).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ');
  const lastX = px(pts.length - 1).toFixed(1);
  const areaD = `M 0,${py(pts[0][1]).toFixed(1)} ` +
    pts.slice(1).map((p, i) => `L ${px(i + 1).toFixed(1)},${py(p[1]).toFixed(1)}`).join(' ') +
    ` L ${lastX},${H} L 0,${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gid})`} />
      <polyline points={linePts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Perps table sorting (shared by HL + Aster) ──────────────────────────────
type HLCol = 'name' | 'px' | 'chg' | 'fund' | 'vol' | 'oi';
const HL_COL_LABELS: Record<HLCol, string> = {
  name: 'Market', px: 'Last Price', chg: '24h Change', fund: '8h Funding', vol: 'Volume', oi: 'Open Interest',
};

function fmtHL(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(2) + 'K';
  return '$' + n.toFixed(2);
}

function fmtHLPx(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  if (n >= 10000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n >= 100) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toPrecision(4);
}

export default function MarketsPage() {
  const { t } = useTranslation();
  const { data: tickers } = useBinanceTicker();
  const { data: klines } = useBtcKlines();
  const { data: global } = useCgGlobal();
  const { data: trending } = useCgTrending();
  const { data: coinsAll } = useCgCoinsMarkets();
  const { data: fg } = useFearGreed();
  const { data: hlTickers } = useHLTickers();

  const [perpMode, setPerpMode] = useState<TradeMode>('hl');
  const { data: asterSymbols } = useAsterSymbols();
  const { data: asterTickers } = useAsterTickers();
  const { data: asterFunding } = useAsterFunding();
  const asterPricesMap = useMemo(() => {
    const m: Record<string, number> = {};
    (asterTickers ?? []).forEach(t => { m[t.symbol] = t.lastPrice; });
    return m;
  }, [asterTickers]);
  const { data: asterOI } = useAsterOpenInterest(asterSymbols ?? [], asterPricesMap, perpMode === 'aster');
  const { data: asterLeverage } = useAsterLeverageBrackets();

  const [hlSort, setHlSort] = useState<{ col: HLCol; dir: 1 | -1 }>({ col: 'vol', dir: -1 });
  const [hlQuery, setHlQuery] = useState('');
  const [cvAmt, setCvAmt] = useState('1');
  const [cvFrom, setCvFrom] = useState('');
  const [cvTo, setCvTo] = useState('__usd');

  const tickerBySym = useMemo(() => new Map((tickers ?? []).map(x => [x.symbol, x])), [tickers]);
  const coins = useMemo(() => (coinsAll ?? []).slice(0, 20), [coinsAll]);

  // ── Sparkline data (fetchSparklines) ───────────────────────────
  const spark = useMemo(() => {
    if (!klines || klines.length < 13) return null;
    const mcPts: Array<[number, number]> = klines.map((k, i) => [i, parseFloat(k[4])]);
    const volPts: Array<[number, number]> = klines.map((k, i) => [i, parseFloat(k[7])]);
    const mcLast = mcPts[mcPts.length - 1][1];
    const mc24ago = mcPts[Math.max(0, mcPts.length - 7)][1];
    const mcPct = mc24ago ? ((mcLast - mc24ago) / mc24ago) * 100 : 0;
    const last6Vol = volPts.slice(-6).reduce((s, p) => s + p[1], 0);
    const prev6Vol = volPts.slice(-12, -6).reduce((s, p) => s + p[1], 0);
    const volPct = prev6Vol ? ((last6Vol - prev6Vol) / prev6Vol) * 100 : 0;
    return { mcPts, volPts, mcPct, volPct };
  }, [klines]);

  // ── Market statistics rows (renderMarketStats) ─────────────────
  const btc = tickerBySym.get('BTCUSDT');
  const eth = tickerBySym.get('ETHUSDT');
  const c0 = coins[0];
  const mstRows: Array<[string, string, string | null, string]> = [
    ['BTC Price', btc ? fmtPx(btc.lastPrice) : '—', btc ? fmtPct(btc.priceChangePercent) : null, btc ? pCls(btc.priceChangePercent) : ''],
    ['ETH Price', eth ? fmtPx(eth.lastPrice) : '—', eth ? fmtPct(eth.priceChangePercent) : null, eth ? pCls(eth.priceChangePercent) : ''],
    ['BTC Market Cap', c0 ? fmtLarge(c0.market_cap) : '—', null, ''],
    ['BTC 24h Volume', c0 ? fmtLarge(c0.total_volume) : '—', null, ''],
    ['Total Market Cap', global ? fmtLarge(global.total_market_cap?.usd ?? 0) : '—',
      global ? fmtPct(global.market_cap_change_percentage_24h_usd ?? 0) : null,
      global ? pCls(global.market_cap_change_percentage_24h_usd ?? 0) : ''],
    ['BTC Dominance', global ? (global.market_cap_percentage?.btc ?? 0).toFixed(1) + '%' : '—', null, ''],
    ['Total Volume 24h', global ? fmtLarge(global.total_volume?.usd ?? 0) : '—', null, ''],
  ];

  // ── Gainers (fetchCoins) ───────────────────────────────────────
  const gainers = useMemo(() => (coinsAll ?? [])
    .filter(c => (c.price_change_percentage_24h ?? 0) > 0)
    .sort((a, b) => (b.price_change_percentage_24h ?? 0) - (a.price_change_percentage_24h ?? 0))
    .slice(0, 7), [coinsAll]);

  // ── Converter (buildConverter) ─────────────────────────────────
  const cvList = useMemo(() => (coinsAll ?? []).slice(0, 12), [coinsAll]);
  const cvFromId = cvFrom || cvList[0]?.id || '';
  const cvFromPx = cvList.find(c => c.id === cvFromId)?.current_price ?? 0;
  const cvToPx = cvTo === '__usd' ? 1 : (cvList.find(c => c.id === cvTo)?.current_price ?? 1) || 1;
  const cvResult = ((parseFloat(cvAmt) || 0) * cvFromPx) / cvToPx;
  const cvResultText = !isFinite(cvResult) ? '—'
    : cvResult >= 1000 ? cvResult.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : cvResult.toFixed(cvResult >= 1 ? 4 : 8);

  // ── Perps rows — HL (fetchHLPerps) or Aster (fetchAsterMids/Funding/OI) ──
  const hlRows = useMemo(() => {
    const rows = perpMode === 'hl'
      ? Object.entries(hlTickers ?? {}).map(([name, s]) => ({
          name,
          maxLev: s.lev,
          px: s.price,
          chgAbs: s.price - s.prevDayPx,
          chgPct: s.chgPct,
          fund8h: s.fund8h * 8, // original: funding * 8 * 100
          vol: s.vol,
          oi: s.oi,
        }))
      : (asterSymbols ?? []).map(name => {
          const t = (asterTickers ?? []).find(x => x.symbol === name);
          const px = t?.lastPrice ?? 0;
          const open = t?.openPrice ?? px;
          return {
            name,
            // Real per-symbol max leverage via the signed V3 leverageBracket
            // endpoint (server/lib/aster-auth.js) — varies by symbol, so this
            // falls back to 0 (rendered "—") rather than guessing a number.
            maxLev: asterLeverage?.[name] ?? 0,
            px,
            chgAbs: px - open,
            chgPct: t?.priceChangePercent ?? 0,
            fund8h: asterFunding?.[name] ?? 0,
            vol: t?.quoteVolume ?? 0,
            oi: asterOI?.[name] ?? 0,
          };
        });

    const filtered = rows.filter(d => !hlQuery || d.name.toLowerCase().includes(hlQuery.toLowerCase()));
    filtered.sort((a, b) => {
      if (hlSort.col === 'name') return hlSort.dir * a.name.localeCompare(b.name);
      const key = hlSort.col === 'px' ? 'px' : hlSort.col === 'chg' ? 'chgPct' : hlSort.col === 'fund' ? 'fund8h' : hlSort.col;
      return hlSort.dir * ((a[key as 'px'] ?? 0) - (b[key as 'px'] ?? 0));
    });
    return filtered;
  }, [perpMode, hlTickers, asterSymbols, asterTickers, asterFunding, asterOI, asterLeverage, hlQuery, hlSort]);

  function clickHLCol(col: HLCol) {
    setHlSort(prev => prev.col === col
      ? { col, dir: prev.dir === 1 ? -1 : 1 }
      : { col, dir: col === 'name' ? 1 : -1 });
  }

  const fgVal = fg?.value;

  return (
    <>
      {/* ─── Ticker bar ─── */}
        <div className="ticker-wrap">
          <div className="ticker-track" id="ticker">
            {[0, 1].map(rep => TICKER_SYMBOLS.map(s => {
              const tk = tickerBySym.get(s);
              return (
                <span key={`${rep}-${s}`} className={`t-item t-${s}`}>
                  <span className="t-sym">{LABEL[s]}</span>
                  <span className="t-px">{tk ? fmtPx(tk.lastPrice) : '—'}</span>
                  <span className={`t-ch ${tk ? pCls(tk.priceChangePercent) : ''}`}>{tk ? ' ' + fmtPct(tk.priceChangePercent) : '—'}</span>
                </span>
              );
            }))}
          </div>
        </div>

        <h1>{t('marketOverview')}</h1>

        {/* Stat cards */}
        <div className="stat-top">
          <div className="big-card">
            <div className="bc-left">
              <div className="bc-val" id="s-mcap">{global ? fmtLarge(global.total_market_cap?.usd ?? 0) : '—'}</div>
              <div className="bc-lbl">
                <span>{t('marketCap')}</span>{' '}
                <span className={`bc-ch ${spark ? pCls(spark.mcPct) : ''}`} id="s-mcap-ch">{spark ? fmtPct(spark.mcPct) : ''}</span>
              </div>
            </div>
            <div className="bc-spark" id="spark-mcap">
              {spark && <Spark rawPts={spark.mcPts} color={spark.mcPct >= 0 ? '#1fa67d' : '#ed7088'} gid="sg-mcap" />}
            </div>
          </div>
          <div className="big-card">
            <div className="bc-left">
              <div className="bc-val" id="s-vol">{global ? fmtLarge(global.total_volume?.usd ?? 0) : '—'}</div>
              <div className="bc-lbl">
                <span>{t('tradingVol24h')}</span>{' '}
                <span className={`bc-ch ${spark ? pCls(spark.volPct) : ''}`} id="s-vol-ch">{spark ? fmtPct(spark.volPct) : ''}</span>
              </div>
            </div>
            <div className="bc-spark" id="spark-vol">
              {spark && <Spark rawPts={spark.volPts} color={spark.volPct >= 0 ? '#1fa67d' : '#ed7088'} gid="sg-vol" />}
            </div>
          </div>
          <div className="small-row">
            <div className="small-card">
              <div className="sc-val" id="s-btc">{global ? (global.market_cap_percentage?.btc ?? 0).toFixed(1) + '%' : '—'}</div>
              <div className="sc-lbl">{t('btcDominance')}</div>
            </div>
            <div className="small-card">
              <div className="sc-val" id="s-fg" style={fgVal ? { color: fgColor(fgVal) } : undefined}>{fgVal ?? '—'}</div>
              <div className="sc-lbl" id="s-fg-l">{fg ? `${fg.value_classification} (${fg.value})` : t('fearGreed')}</div>
            </div>
          </div>
        </div>

        {/* Market Statistics */}
        <div className="mkt-stats-wrap">
          <div className="mkt-stats-hdr">{t('marketStats')}</div>
          <div id="mkt-stats-body">
            {mstRows.map(([lbl, val, ch, cls]) => (
              <div key={lbl} className="mst-row">
                <span className="mst-lbl">{lbl}</span>
                <span className="mst-val">{val}{ch ? <span className={`mst-ch ${cls}`}>{ch}</span> : null}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Trending + Top Gainers */}
        <div className="panels">
          <div className="panel">
            <div className="panel-hdr">{t('trending')}</div>
            <div id="trending">
              {!trending ? <div className="loading-rows">Loading…</div> : trending.slice(0, 7).map((c, i) => {
                const item = c.item;
                const ch = item.data?.price_change_percentage_24h?.usd ?? 0;
                const px = item.data?.price ?? 0;
                return (
                  <div key={item.symbol + i} className="prow">
                    <div className="prow-l">
                      <div className="rank-badge">{i + 1}</div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="coin-img" src={item.small || item.thumb} alt="" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                      <div>
                        <div className="coin-nm">{item.name}</div>
                        <div className="coin-sy">{item.symbol.toUpperCase()}</div>
                      </div>
                    </div>
                    <div className="prow-r">
                      {px > 0 && <div className="p-price">{fmtPx(px)}</div>}
                      <div className={`p-pct ${pCls(ch)}`}>{fmtPct(ch)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <div className="panel-hdr">{t('topGainers')}</div>
            <div id="gainers">
              {!coinsAll ? <div className="loading-rows">Loading…</div> : gainers.map(c => (
                <div key={c.id} className="prow">
                  <div className="prow-l">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="coin-img" src={c.image} alt="" loading="lazy" onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                    <div>
                      <div className="coin-nm">{c.name}</div>
                      <div className="coin-sy">{c.symbol.toUpperCase()}</div>
                    </div>
                  </div>
                  <div className="prow-r">
                    <div className="p-price">{fmtPx(c.current_price)}</div>
                    <div className="p-pct up">{fmtPct(c.price_change_percentage_24h ?? 0)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Converter */}
        <div className="conv-wrap">
          <div className="panel-hdr">{t('converter')}</div>
          <div className="conv-body">
            <div className="conv-side">
              <input className="conv-input" type="number" id="cv-amt" min={0} value={cvAmt} onChange={e => setCvAmt(e.target.value)} />
              <select className="conv-sel" id="cv-from" value={cvFromId} onChange={e => setCvFrom(e.target.value)}>
                {cvList.map(c => <option key={c.id} value={c.id}>{c.symbol.toUpperCase()}</option>)}
              </select>
            </div>
            <div className="conv-arrow">⇌</div>
            <div className="conv-side">
              <div className="conv-result" id="cv-result">{cvList.length ? cvResultText : '—'}</div>
              <select className="conv-sel" id="cv-to" value={cvTo} onChange={e => setCvTo(e.target.value)}>
                <option value="__usd">USD</option>
                {cvList.map(c => <option key={c.id} value={c.id}>{c.symbol.toUpperCase()}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Perpetuals — Hyperliquid (Basic) / Aster (Extra) */}
        <div className="hl-wrap">
          <div className="hl-top">
            <div className="perp-mode-switch">
              <button
                className={`perp-mode-btn${perpMode === 'hl' ? ' active' : ''}`}
                onClick={() => setPerpMode('hl')}
              >
                BASIC
              </button>
              <button
                className={`perp-mode-btn extra${perpMode === 'aster' ? ' active' : ''}`}
                onClick={() => setPerpMode('aster')}
              >
                EXTRA
              </button>
            </div>
            <div className="hl-search-box">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
              <input className="hl-search" id="hl-search" placeholder="Search" value={hlQuery} onChange={e => setHlQuery(e.target.value)} />
            </div>
          </div>
          <table className="hl-tbl">
            <thead>
              <tr>
                {(Object.keys(HL_COL_LABELS) as HLCol[]).map(col => (
                  <th
                    key={col}
                    className={`${col === 'name' ? 'l' : ''}${hlSort.col === col ? ' sort-active' : ''}`.trim() || undefined}
                    data-col={col}
                    onClick={() => clickHLCol(col)}
                  >
                    {HL_COL_LABELS[col]}{hlSort.col === col ? (hlSort.dir < 0 ? ' ↓' : ' ↑') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody id="hl-tbody">
              {hlRows.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--text3)' }}>Loading…</td></tr>
              ) : hlRows.map(d => {
                const chgCls = d.chgPct >= 0 ? 'up' : 'dn';
                const fundCls = d.fund8h >= 0 ? 'up' : 'dn';
                const chgSign = d.chgPct >= 0 ? '+' : '';
                return (
                  <tr key={d.name} onClick={() => { window.location.href = `/?sym=${encodeURIComponent(d.name)}&mode=${perpMode}`; }}>
                    <td>
                      <div className="hl-market">
                        <span className="hl-star">☆</span>
                        <span className="hl-sym">{d.name}{perpMode === 'aster' ? '-USDT' : '-USDC'}</span>
                        <span className="hl-lev">{d.maxLev ? `${d.maxLev}x` : '—'}</span>
                      </div>
                    </td>
                    <td>{fmtHLPx(d.px)}</td>
                    <td className={`hl-ch-val ${chgCls}`}>{chgSign}{d.chgAbs.toFixed(d.px >= 100 ? 2 : 4)} / {chgSign}{d.chgPct.toFixed(2)}%</td>
                    <td className={fundCls}>{d.fund8h >= 0 ? '+' : ''}{d.fund8h.toFixed(4)}%</td>
                    <td>{fmtHL(d.vol)}</td>
                    <td>{fmtHL(d.oi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Top 20 table */}
        <div className="tbl-wrap">
          <div className="tbl-hdr">
            <span className="tbl-title">{t('topByMcap')}</span>
            <span className="tbl-ts" id="tbl-ts">{coins.length ? 'Updated ' + new Date().toLocaleTimeString() : '—'}</span>
          </div>
          <div id="coins-tbl">
            {!coins.length ? <div className="loading-rows">Loading market data…</div> : (
              <table>
                <thead>
                  <tr>
                    <th className="l" style={{ width: 32 }}>#</th>
                    <th className="l">Name</th>
                    <th>Price</th>
                    <th>24h %</th>
                    <th>7d %</th>
                    <th>Market Cap</th>
                    <th>Volume (24h)</th>
                  </tr>
                </thead>
                <tbody>
                  {coins.map(c => {
                    const ch24 = c.price_change_percentage_24h ?? 0;
                    const ch7d = c.price_change_percentage_7d_in_currency ?? 0;
                    return (
                      <tr key={c.id} className="coin-row">
                        <td style={{ color: 'var(--text3)', fontSize: 11 }}>{c.market_cap_rank}</td>
                        <td>
                          <div className="td-nm">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.image} alt="" width={22} height={22} style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} loading="lazy" onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                            <div>
                              <div className="td-nm-n">{c.name}</div>
                              <div className="td-nm-s">{c.symbol.toUpperCase()}</div>
                            </div>
                          </div>
                        </td>
                        <td className="td-px">{fmtPx(c.current_price)}</td>
                        <td className="td-r"><span className={`badge ${pCls(ch24)}`}>{ch24 >= 0 ? '▲' : '▼'} {Math.abs(ch24).toFixed(2)}%</span></td>
                        <td className="td-r"><span className={`badge ${pCls(ch7d)}`}>{ch7d >= 0 ? '▲' : '▼'} {Math.abs(ch7d).toFixed(2)}%</span></td>
                        <td className="td-r">{fmtLarge(c.market_cap)}</td>
                        <td className="td-r">{fmtLarge(c.total_volume)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
    </>
  );
}
