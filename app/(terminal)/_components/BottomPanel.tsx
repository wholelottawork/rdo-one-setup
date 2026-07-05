'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { fmtPrice, fmtSize, type TradeMode } from '@/lib/markets';
import type { Position, Fill, OpenOrder, FundingEntry } from '@/lib/hyperliquid';

type Tab = 'positions' | 'balances' | 'open-orders' | 'trade-history' | 'funding' | 'order-history';

interface Props {
  mode: TradeMode;
  address: string | null;
  positions: Position[];
  fills: Fill[];
  openOrders: OpenOrder[];
  funding: FundingEntry[];
  livePrices: Record<string, number>;
  onClosePosition: (index: number) => void;
  onCancelOrder: (oid: number, symbol: string) => void;
  onTabData: (tab: Tab) => void;
}

// Bottom panel + vertical resize handle — verbatim structure from index.html;
// row markup mirrors renderPositions/renderFills/renderOpenOrders/
// renderFundingHistory in main.js (including their inline style strings).
export function BottomPanel({ mode, address, positions, fills, openOrders, funding, livePrices, onClosePosition, onCancelOrder, onTabData }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('positions');
  const handleRef = useRef<HTMLDivElement>(null);

  // main.js initBtmResize() — drag adjusts the --btm CSS variable
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const root = document.documentElement;
    const MIN = 60, MAX = 480;
    let dragging = false, startY = 0, startH = 0;

    const onDown = (e: MouseEvent) => {
      dragging = true;
      startY = e.clientY;
      startH = parseInt(getComputedStyle(root).getPropertyValue('--btm')) || 175;
      handle.classList.add('dragging');
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging) return;
      const h = Math.min(MAX, Math.max(MIN, startH + (startY - e.clientY)));
      root.style.setProperty('--btm', h + 'px');
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    handle.addEventListener('mousedown', onDown);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      handle.removeEventListener('mousedown', onDown);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, []);

  const selectTab = (next: Tab) => {
    setTab(next);
    onTabData(next);
  };

  const TABS: Array<[Tab, string]> = [
    ['positions', t('positions')],
    ['balances', t('balances')],
    ['open-orders', t('openOrders')],
    ['trade-history', t('tradeHistory')],
    ['funding', t('fundingHistory')],
    ['order-history', t('orderHistory')],
  ];

  const modeLbl = mode === 'aster' ? 'EXTRA' : 'BASIC';
  const modeCls = mode === 'aster' ? 'pos-mode-extra' : 'pos-mode-basic';

  return (
    <>
      {/* ══ VERTICAL RESIZE HANDLE ══ */}
      <div className="btm-resize-handle" id="btmResizeHandle" ref={handleRef}></div>

      {/* ══ BOTTOM PANEL ══ */}
      <section className="btm-panel">
        <div className="btm-tabs">
          {TABS.map(([key, label]) => (
            <button key={key} className={`btm-tab${tab === key ? ' active' : ''}`} onClick={() => selectTab(key)}>{label}</button>
          ))}
        </div>

        <div className="btm-content">
          {/* POSITIONS */}
          <div id="btPositions" className={`btm-pane${tab === 'positions' ? '' : ' hidden'}`}>
            <div className="btm-col-hdr">
              <span>{t('market')}</span>
              <span>{t('mode')}</span>
              <span>{t('size')}</span>
              <span>{t('positionValue')}</span>
              <span>{t('entryPrice')}</span>
              <span>{t('markPrice')}</span>
              <span>{t('pnlRoe')}</span>
              <span>{t('liqPriceShort')}</span>
              <span>{t('margin')}</span>
              <span>{t('funding')}</span>
            </div>
            <div id="posRows" className="btm-rows">
              {positions.length === 0 ? (
                <div className="btm-empty">{t('noPositions')}</div>
              ) : (
                positions.map((p, i) => {
                  const pnlCls = p.pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
                  const px = livePrices[p.symbol] || p.entryPrice;
                  const roe = p.entryPrice
                    ? ((px - p.entryPrice) / p.entryPrice) * p.leverage * (p.isLong ? 1 : -1) * 100
                    : 0;
                  return (
                    <div key={i} className="pos-row">
                      <span className="pos-sym">{p.symbol}</span>
                      <span><span className={`pos-mode-tag ${modeCls}`}>{modeLbl}</span></span>
                      <span>{p.size.toFixed(4)}</span>
                      <span>${(Math.abs(p.size) * px).toFixed(2)}</span>
                      <span>{fmtPrice(p.entryPrice)}</span>
                      <span>{fmtPrice(px)}</span>
                      <span className={pnlCls}>{p.pnl >= 0 ? '+' : ''}${p.pnl.toFixed(2)} ({roe.toFixed(2)}%)</span>
                      <span>{fmtPrice(p.liqPrice)}</span>
                      <span>—</span><span>—</span>
                      <span className={p.isLong ? 'dir-long' : 'dir-short'}>{p.isLong ? 'Long' : 'Short'}</span>
                      <span><button className="pos-close-btn" onClick={() => onClosePosition(i)}>Close</button></span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* BALANCES */}
          <div id="btBalances" className={`btm-pane${tab === 'balances' ? '' : ' hidden'}`}>
            <div className="btm-empty">{t('connectBalances')}</div>
          </div>

          {/* OPEN ORDERS */}
          <div id="btOpenOrders" className={`btm-pane${tab === 'open-orders' ? '' : ' hidden'}`}>
            {!address || openOrders.length === 0 ? (
              <div className="btm-empty">{t('noOpenOrders')}</div>
            ) : (
              <>
                <div className="btm-col-hdr" style={{ gridTemplateColumns: '70px 60px 100px 80px 80px 1fr 60px' }}>
                  <span>Market</span><span>Side</span><span>Price</span>
                  <span>Size</span><span>Filled</span><span>Time</span><span></span>
                </div>
                {openOrders.map(o => {
                  const filled = o.origSize - o.size;
                  return (
                    <div key={o.oid} className="pos-row" style={{ gridTemplateColumns: '70px 60px 100px 80px 80px 1fr 60px' }}>
                      <span className="pos-sym">{o.coin}</span>
                      <span className={o.side === 'Buy' ? 'dir-long' : 'dir-short'}>{o.side}</span>
                      <span>{fmtPrice(o.price)}</span>
                      <span>{fmtSize(o.size)}</span>
                      <span>{fmtSize(filled)}</span>
                      <span style={{ color: 'var(--hl-text-muted)' }}>{new Date(o.time).toLocaleString()}</span>
                      <span><button className="pos-close-btn" onClick={() => onCancelOrder(o.oid, o.coin)}>Cancel</button></span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* TRADE HISTORY */}
          <div id="btTradeHistory" className={`btm-pane${tab === 'trade-history' ? '' : ' hidden'}`}>
            {!address || fills.length === 0 ? (
              <div className="btm-empty">{t('noTradeHistory')}</div>
            ) : (
              <>
                <div className="btm-col-hdr" style={{ gridTemplateColumns: '70px 60px 100px 80px 80px 80px 80px 1fr' }}>
                  <span>Market</span><span>Side</span><span>Price</span>
                  <span>Size</span><span>Fee</span><span>PnL</span><span>Dir</span><span>Time</span>
                </div>
                {fills.slice(0, 200).map((f, i) => {
                  const pnlCls = f.pnl > 0 ? 'pnl-pos' : f.pnl < 0 ? 'pnl-neg' : '';
                  return (
                    <div key={i} className="pos-row" style={{ gridTemplateColumns: '70px 60px 100px 80px 80px 80px 80px 1fr' }}>
                      <span className="pos-sym">{f.coin}</span>
                      <span className={f.side === 'Buy' ? 'dir-long' : 'dir-short'}>{f.side}</span>
                      <span>{fmtPrice(f.price)}</span>
                      <span>{fmtSize(f.size)}</span>
                      <span>${f.fee.toFixed(4)}</span>
                      <span className={pnlCls}>{f.pnl !== 0 ? (f.pnl > 0 ? '+' : '') + '$' + f.pnl.toFixed(2) : '—'}</span>
                      <span style={{ color: 'var(--hl-text-muted)', fontSize: 10 }}>{f.dir}</span>
                      <span style={{ color: 'var(--hl-text-muted)' }}>{new Date(f.time).toLocaleString()}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* FUNDING */}
          <div id="btFunding" className={`btm-pane${tab === 'funding' ? '' : ' hidden'}`}>
            {!address || funding.length === 0 ? (
              <div className="btm-empty">{t('noFundingHistory')}</div>
            ) : (
              <>
                <div className="btm-col-hdr" style={{ gridTemplateColumns: '70px 80px 80px 80px 1fr' }}>
                  <span>Market</span><span>Payment</span><span>Rate</span><span>Size</span><span>Time</span>
                </div>
                {funding.slice(0, 200).map((f, i) => {
                  const cls = f.usdc >= 0 ? 'pnl-pos' : 'pnl-neg';
                  return (
                    <div key={i} className="pos-row" style={{ gridTemplateColumns: '70px 80px 80px 80px 1fr' }}>
                      <span className="pos-sym">{f.coin}</span>
                      <span className={cls}>{f.usdc >= 0 ? '+' : ''}${f.usdc.toFixed(4)}</span>
                      <span>{(f.rate * 100).toFixed(4)}%</span>
                      <span>{fmtSize(Math.abs(f.size))}</span>
                      <span style={{ color: 'var(--hl-text-muted)' }}>{new Date(f.time).toLocaleString()}</span>
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* ORDER HISTORY */}
          <div id="btOrderHistory" className={`btm-pane${tab === 'order-history' ? '' : ' hidden'}`}>
            <div className="btm-empty">{t('noOrderHistory')}</div>
          </div>
        </div>
      </section>
    </>
  );
}
