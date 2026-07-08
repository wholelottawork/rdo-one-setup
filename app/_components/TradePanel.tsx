'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { useWallet } from '@/lib/wallet';
import { fmtPrice, fmtLarge, type TradeMode } from '@/lib/markets';
import type { OrderBook } from '@/lib/hyperliquid';

interface Props {
  mode: TradeMode;
  market: string;
  isBuy: boolean;
  size: string;
  leverage: number;
  livePrice: number | undefined;
  balance: number;
  currentPositionSize: number | null; // null = no position
  totalUnrealizedPnl: number;
  submitting: boolean;
  error: string | null;
  book: OrderBook;
  onSideChange: (buy: boolean) => void;
  onSizeChange: (v: string) => void;
  onLeverageChange: (v: number) => void;
  onSubmit: () => void;
}

// Order-book row price/size formatting — verbatim from renderOrderBook()
const fmtPx = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
const fmtSz = (n: number) => (n >= 1 ? n.toFixed(2) : n >= 0.001 ? n.toFixed(3) : n.toFixed(4));

// Trade panel — verbatim structure from index.html (margin row, order tabs,
// sides, form, stats, account equity, perps overview, collapsible ob-mini).
export function TradePanel({
  mode, market, isBuy, size, leverage, livePrice, balance, currentPositionSize,
  totalUnrealizedPnl, submitting, error, book,
  onSideChange, onSizeChange, onLeverageChange, onSubmit,
}: Props) {
  const { t } = useTranslation();
  const { address } = useWallet();
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');
  const [obCollapsed, setObCollapsed] = useState(false);
  const [sliderVal, setSliderVal] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const maxLev = mode === 'aster' ? 200 : 50;

  // ── updateStats() ────────────────────────────────────────────
  const px = livePrice ?? 0;
  const sizeNum = parseFloat(size) || 0;
  const notional = sizeNum * px;
  const margin = leverage ? notional / leverage : 0;
  const liqMove = leverage ? 0.975 / leverage : 0;
  const liqPx = px ? (isBuy ? px * (1 - liqMove) : px * (1 + liqMove)) : 0;
  const feeRate = mode === 'aster' ? 0.0004 : 0.00045;
  const feeLabel = mode === 'aster' ? '0.0400% Taker / 0.0000% Maker' : '0.0450% / 0.0150%';
  const feePct = mode === 'aster' ? '0.0400%' : '0.0450%';

  // ── renderOrderBook() cumulative rows ────────────────────────
  const { cumAsks, cumBids, maxCum, spread, spreadPct } = useMemo(() => {
    const sortedAsks = [...book.asks].sort((a, b) => a.px - b.px);
    const sortedBids = [...book.bids].sort((a, b) => b.px - a.px);
    let ca = 0, cb = 0;
    const asks = sortedAsks.map(r => { ca += r.sz; return { ...r, cum: ca }; });
    const bids = sortedBids.map(r => { cb += r.sz; return { ...r, cum: cb }; });
    const bestAsk = sortedAsks[0]?.px ?? 0;
    const bestBid = sortedBids[0]?.px ?? 0;
    const sp = bestAsk && bestBid ? bestAsk - bestBid : 0;
    return {
      cumAsks: asks, cumBids: bids,
      maxCum: Math.max(ca, cb) || 1,
      spread: sp,
      spreadPct: bestBid ? (sp / bestBid) * 100 : 0,
    };
  }, [book]);

  function handleSlider(val: number) {
    setSliderVal(val);
    if (!address || !px) return;
    onSizeChange(((balance * leverage * (val / 100)) / px).toFixed(6));
  }

  const obRow = (cls: 'ask' | 'bid', r: { px: number; sz: number; cum: number }, i: number) => (
    <div key={i} className={`ob-row ${cls}`}>
      <span className="ob-price">{fmtPx(r.px)}</span>
      <span className="ob-sz">{fmtSz(r.sz)}</span>
      <span className="ob-total">{fmtSz(r.cum)}</span>
      <div className="ob-depth" style={{ width: `${((r.cum / maxCum) * 100).toFixed(1)}%` }}></div>
    </div>
  );

  return (
    <aside className="tp-col">

      {/* margin / leverage row */}
      <div className="tp-margin-row">
        <select className="tp-select" id="marginType" defaultValue={t('cross')}>
          <option>{t('cross')}</option>
          <option>{t('isolated')}</option>
        </select>
        <div className="tp-lev-wrap">
          <input
            id="levInput"
            className="tp-lev-input"
            type="number"
            min={1}
            max={maxLev}
            value={leverage}
            onChange={e => onLeverageChange(Math.min(maxLev, Math.max(1, parseInt(e.target.value) || 1)))}
          />
          <span className="tp-lev-x">x</span>
        </div>
        <select className="tp-select">
          <option>{t('unified')}</option>
        </select>
      </div>

      {/* order type tabs */}
      <div className="tp-order-tabs">
        <button className={`tp-otab${orderType === 'market' ? ' active' : ''}`} onClick={() => setOrderType('market')}>{t('market')}</button>
        <button className={`tp-otab${orderType === 'limit' ? ' active' : ''}`} onClick={() => setOrderType('limit')}>{t('limit')}</button>
      </div>

      {/* buy / sell buttons */}
      <div className="tp-sides">
        <button id="btnBuy" className={`tp-side tp-buy${isBuy ? ' active' : ''}`} onClick={() => onSideChange(true)}>{t('buyLong')}</button>
        <button id="btnSell" className={`tp-side tp-sell${!isBuy ? ' active' : ''}`} onClick={() => onSideChange(false)}>{t('sellShort')}</button>
      </div>

      {/* trade form */}
      <div className="tp-form">
        <div className="tp-info-row">
          <span className="tp-info-label">{t('availableTrade')}</span>
          <span id="tpAvail" className="tp-info-val">{mounted && address ? `$${balance.toFixed(2)} USDC` : '0.00 USDC'}</span>
        </div>
        <div className="tp-info-row">
          <span className="tp-info-label">{t('currentPosition')}</span>
          <span id="tpCurPos" className="tp-info-val">
            {currentPositionSize != null
              ? `${currentPositionSize >= 0 ? '+' : ''}${currentPositionSize.toFixed(5)} ${market}`
              : `0.00000 ${market}`}
          </span>
        </div>

        <div className="tp-field-label">{t('size')}</div>
        <div className="tp-size-wrap">
          <input
            id="sizeInput"
            className="tp-size-input"
            type="number"
            placeholder="0"
            min={0}
            value={size}
            onChange={e => onSizeChange(e.target.value)}
          />
          <div className="tp-size-unit" id="sizeUnit">{market}</div>
        </div>

        {/* slider */}
        <input
          id="sizeSlider"
          className="tp-slider"
          type="range"
          min={0}
          max={100}
          value={sliderVal}
          onChange={e => handleSlider(parseInt(e.target.value))}
        />
        <div className="tp-slider-marks">
          <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
        </div>

        {/* options */}
        <div className="tp-options">
          <label className="tp-check">
            <input type="checkbox" id="chkReduce" />
            <span>{t('reduceOnly')}</span>
          </label>
          <label className="tp-check">
            <input type="checkbox" id="chkTpSl" />
            <span>{t('tpsl')}</span>
          </label>
        </div>

        {/* connect / trade button */}
        <button
          id="tradeBtn"
          className={`tp-action-btn ${isBuy ? 'tp-buy-bg' : 'tp-sell-bg'}`}
          disabled={submitting}
          onClick={onSubmit}
        >
          {submitting ? 'Confirming...' : mounted && address ? `${isBuy ? t('buyLong') : t('sellShort')} ${market}` : t('connect')}
        </button>

        <div id="tradeErr" className={`tp-err${error ? '' : ' hidden'}`}>{error}</div>

        {/* order stats */}
        <div className="tp-stats">
          <div className="tp-stat-row">
            <span>{t('liqPrice')}</span>
            <span id="stLiq">{liqPx ? fmtPrice(liqPx) : 'N/A'}</span>
          </div>
          <div className="tp-stat-row">
            <span>{t('orderValue')}</span>
            <span id="stVal">{notional ? '$' + fmtLarge(notional) : 'N/A'}</span>
          </div>
          <div className="tp-stat-row">
            <span>{t('marginRequired')}</span>
            <span id="stMargin">{margin ? '$' + margin.toFixed(2) : '--'}</span>
          </div>
          <div className="tp-stat-row">
            <span>{t('slippage')}</span>
            <span id="stSlip">--</span>
          </div>
          <div className="tp-stat-row">
            <span>{t('fee')}</span>
            <span id="stFee">{notional ? `$${(notional * feeRate).toFixed(4)} (${feePct})` : feeLabel}</span>
          </div>
        </div>

        {/* account equity */}
        <div className="tp-section-title">{t('accountEquity')}</div>
        <div className="tp-stats">
          <div className="tp-stat-row">
            <span>{t('spot')}</span>
            <span id="eqSpot">$0.00</span>
          </div>
          <div className="tp-stat-row">
            <span><a href="#" className="tp-link">{t('perps')}</a></span>
            <span id="eqPerps">${balance.toFixed(2)}</span>
          </div>
        </div>

        {/* perps overview */}
        <div className="tp-section-title">{t('perpsOverview')}</div>
        <div className="tp-stats">
          <div className="tp-stat-row">
            <span><a href="#" className="tp-link">{t('balance')}</a></span>
            <span id="ovBalance">${balance.toFixed(2)}</span>
          </div>
          <div className="tp-stat-row">
            <span>{t('unrealizedPnl')}</span>
            <span id="ovPnl">{`${totalUnrealizedPnl >= 0 ? '+' : ''}$${totalUnrealizedPnl.toFixed(2)}`}</span>
          </div>
          <div className="tp-stat-row">
            <span>{t('crossMarginRatio')}</span>
            <span id="ovCmr">0.00%</span>
          </div>
          <div className="tp-stat-row">
            <span><a href="#" className="tp-link">{t('maintenanceMargin')}</a></span>
            <span id="ovMm">$0.00</span>
          </div>
          <div className="tp-stat-row">
            <span><a href="#" className="tp-link">{t('crossAccountLev')}</a></span>
            <span id="ovLev">0.00x</span>
          </div>
        </div>
      </div>

      {/* ─ ORDER BOOK ─ */}
      <div className={`ob-mini${obCollapsed ? ' collapsed' : ''}`} id="obMini">
        <div className="ob-mini-hdr" onClick={() => setObCollapsed(c => !c)} style={{ cursor: 'pointer' }}>
          <span className="ob-mini-title">{t('orderBook')}</span>
          <button className="ob-toggle-btn" id="obToggleBtn" aria-label="Toggle order book"></button>
          <div className="ob-colhdr" id="obColHdr" style={{ flex: 1 }}>
            <span>{t('price')}</span><span>{t('size')}</span><span>{t('total')}</span>
          </div>
        </div>
        <div id="obBody">
          <div id="obAsks" className="ob-asks ob-asks-mini">
            {cumAsks.map((r, i) => obRow('ask', r, i))}
          </div>
          <div className="ob-spread-row">
            <span className="ob-spread-label">{t('spread')}</span>
            <span id="obSpreadVal" className="ob-spread-val">{spread ? fmtPx(spread) : '—'}</span>
            <span id="obSpreadPct" className="ob-spread-pct">{spread ? spreadPct.toFixed(3) + '%' : ''}</span>
          </div>
          <div id="obBids" className="ob-bids">
            {cumBids.map((r, i) => obRow('bid', r, i))}
          </div>
        </div>
      </div>
    </aside>
  );
}
