'use client';
import { useState, useRef, useEffect } from 'react';

const LEV_PRESETS = [1, 2, 5, 10, 20, 50];

function MarginTypePicker() {
  const [isCross, setIsCross] = useState(true);

  function pick(cross: boolean) {
    setIsCross(cross);
    const el = document.getElementById('marginType') as HTMLSelectElement;
    if (el) el.value = cross ? 'cross' : 'isolated';
  }

  return (
    <div className="margin-toggle">
      <button className={`margin-btn${isCross ? ' active' : ''}`} onClick={() => pick(true)}>Cross</button>
      <button className={`margin-btn${!isCross ? ' active' : ''}`} onClick={() => pick(false)}>Isolated</button>
      <select id="marginType" defaultValue="cross" style={{ display: 'none' }}>
        <option value="cross">Cross</option>
        <option value="isolated">Isolated</option>
      </select>
    </div>
  );
}

function LeveragePicker() {
  const [open, setOpen] = useState(false);
  const [lev, setLev] = useState(20);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOutside(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  function apply(val: number) {
    const el = document.getElementById('levInput') as HTMLInputElement;
    const max = parseInt(el?.max || '50') || 50;
    const v = Math.min(Math.max(Math.round(val), 1), max);
    setLev(v);
    if (el) {
      el.value = String(v);
      (window as any).rdo?.updateStats?.();
    }
  }

  function handleOpen() {
    const el = document.getElementById('levInput') as HTMLInputElement;
    const cur = parseInt(el?.value) || 20;
    setLev(cur);
    setOpen(o => !o);
  }

  return (
    <div ref={ref} className="relative">
      <button
        className="lev-trigger"
        onClick={handleOpen}
      >
        {lev}x
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><path d="M6 9l6 6 6-6"/></svg>
      </button>
      {open && (
        <>
          <div className="lev-backdrop" onClick={() => setOpen(false)} />
          <div className="lev-popover">
            <div className="lev-popover-title">Leverage</div>
            <div className="lev-popover-val">{lev}x</div>
            <input
              type="range"
              min={1}
              max={50}
              value={lev}
              onChange={e => apply(parseInt(e.target.value))}
              className="tp-slider"
              style={{ width: '100%', marginBottom: '10px' }}
            />
            <div className="lev-presets">
              {LEV_PRESETS.map(p => (
                <button
                  key={p}
                  className={`lev-preset${lev === p ? ' active' : ''}`}
                  onClick={() => { apply(p); setOpen(false); }}
                >
                  {p}x
                </button>
              ))}
            </div>
            <button className="lev-confirm" onClick={() => setOpen(false)}>
              Confirm
            </button>
          </div>
        </>
      )}
      {/* Hidden input kept for imperative TradingTerminal compatibility */}
      <input
        id="levInput"
        type="number"
        min={1}
        max={50}
        defaultValue={20}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
        onChange={() => {}}
      />
    </div>
  );
}

function SizeUnitToggle() {
  const [unit, setUnit] = useState<'asset' | 'usd'>('asset');
  const [asset, setAsset] = useState('BTC');

  useEffect(() => {
    (window as any).rdo = (window as any).rdo || {};
    (window as any).rdo.setAssetLabel = (label: string) => setAsset(label);
  }, []);

  function toggle() {
    const next = unit === 'asset' ? 'usd' : 'asset';
    setUnit(next);
    setTimeout(() => (window as any).rdo?.updateStats?.(), 0);
  }

  return (
    <>
      <button type="button" className="size-unit-toggle" onClick={toggle}>
        {unit === 'asset' ? asset : 'USD'}
      </button>
      <input id="sizeUnitInput" type="hidden" value={unit} readOnly />
    </>
  );
}

const SIZE_STEPS = [0, 25, 50, 75, 100];

function SizeSlider() {
  const [pct, setPct] = useState(0);
  const [dragging, setDragging] = useState(false);

  function apply(val: number) {
    setPct(val);
    const el = document.getElementById('sizeSlider') as HTMLInputElement;
    if (el) el.value = String(val);
    (window as any).rdo?.onSlider(val);
  }

  return (
    <div
      className="size-slider-wrap"
      onMouseEnter={() => setDragging(true)}
      onMouseLeave={() => setDragging(false)}
    >
      <div className="size-slider-track">
        <div className="size-slider-fill" style={{ width: `${pct}%` }} />
        {SIZE_STEPS.map(s => (
          <button
            key={s}
            className={`size-slider-dot${pct >= s ? ' active' : ''}`}
            style={{ left: `${s}%` }}
            onClick={() => apply(s)}
          />
        ))}
        {(dragging || pct > 0) && (
          <div className="size-slider-tooltip" style={{ left: `${pct}%` }}>
            {pct}%
          </div>
        )}
        <input
          id="sizeSlider"
          type="range"
          min={0}
          max={100}
          value={pct}
          className="size-slider-input"
          onMouseDown={() => setDragging(true)}
          onMouseUp={() => setDragging(false)}
          onChange={(e) => apply(parseInt(e.target.value))}
        />
      </div>
    </div>
  );
}

// Trade page (/) — extracted from TradingTerminal. Pure markup: all
// behaviour is wired imperatively by TradingTerminal's init() via ids.
export function OrderPanel() {
  const [orderType, setOrderType] = useState<'market' | 'limit'>('market');

  function switchOrderType(type: 'market' | 'limit') {
    setOrderType(type);
    // Order value / margin / liq / slippage are all derived from the entry
    // price, which just changed basis (limit price vs mark) — without this
    // the panel keeps showing the previous type's numbers.
    setTimeout(() => (window as any).rdo?.updateStats?.(), 0);
  }

  return (
    <>
        {/* Trade Panel */}
        <aside className="flex flex-col bg-[var(--hl-bg-base)] overflow-y-auto">
          <div className="flex items-center justify-center gap-2 py-2 px-3 border-b border-[#1f1f1f] shrink-0 h-12 box-border">
            <MarginTypePicker />
            <LeveragePicker />
            <div className="margin-toggle">
              <span className="margin-btn active" data-i18n="unified">Unified</span>
            </div>
          </div>
          <div className="flex border-b border-[#1f1f1f] shrink-0 h-8">
            <button
              className={`tp-otab${orderType === 'market' ? ' active' : ''}`}
              data-ot="market"
              data-i18n="market"
              onClick={() => switchOrderType('market')}
            >
              Market
            </button>
            <button
              className={`tp-otab${orderType === 'limit' ? ' active' : ''}`}
              data-ot="limit"
              data-i18n="limit"
              onClick={() => switchOrderType('limit')}
            >
              Limit
            </button>
          </div>
          {/* Hidden input for orderFlow to read order type */}
          <input id="orderTypeInput" type="hidden" value={orderType} readOnly />
          <div className="grid grid-cols-2 gap-1.5 pt-3 pb-3 px-3 shrink-0">
            <button
              id="btnBuy"
              className="tp-side tp-buy active"
              onClick={() => (window as any).rdo?.setSide(true)}
              data-i18n="buyLong"
            >
              Buy / Long
            </button>
            <button
              id="btnSell"
              className="tp-side tp-sell"
              onClick={() => (window as any).rdo?.setSide(false)}
              data-i18n="sellShort"
            >
              Sell / Short
            </button>
          </div>
          <div className="px-3 pb-2 flex flex-col gap-1.5 shrink-0">
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[var(--hl-text-secondary)]" data-i18n="availableTrade">
                Available to Trade
              </span>
              <span id="tpAvail" className="text-[var(--hl-text-soft)]">
                0.00 USDC
              </span>
            </div>
            <div className="flex justify-between items-center text-[11px]">
              <span className="text-[var(--hl-text-secondary)]" data-i18n="currentPosition">
                Current Position
              </span>
              <span id="tpCurPos" className="text-[var(--hl-text-soft)]">
                0.00000 BTC
              </span>
            </div>
            {orderType === 'limit' && (
              <>
                <div className="text-[9px] text-[var(--hl-text-secondary)] tracking-[0.4px] uppercase mt-0.5">
                  Limit Price
                </div>
                <div className="tp-size-wrap">
                  <input
                    id="limitInput"
                    className="flex-1 bg-transparent border-none outline-none font-[var(--hl-font)] text-[13px] font-medium text-white py-[7px] px-2 placeholder:text-[var(--hl-text-secondary)] placeholder:text-[11px]"
                    type="number"
                    placeholder="0.00"
                    min={0}
                    onChange={() => (window as any).rdo?.updateStats()}
                  />
                  <div className="py-0 px-2 text-[10px] text-[var(--hl-text-secondary)] border-l border-[var(--hl-border)] cursor-default">
                    USDC
                  </div>
                </div>
              </>
            )}
            <div className="text-[9px] text-[var(--hl-text-secondary)] tracking-[0.4px] uppercase mt-0.5" data-i18n="size">
              Size
            </div>
            <div className="tp-size-wrap">
              <input
                id="sizeInput"
                className="flex-1 bg-transparent border-none outline-none font-[var(--hl-font)] text-[13px] font-medium text-white py-[7px] px-2 placeholder:text-[var(--hl-text-secondary)] placeholder:text-[11px]"
                type="number"
                placeholder="0"
                min={0}
                onChange={() => (window as any).rdo?.updateStats()}
              />
              <SizeUnitToggle />
            </div>
            <SizeSlider />
            <div className="flex flex-col gap-1.5 mt-0.5">
              <label className="tp-check">
                <input type="checkbox" id="chkReduce" />
                <span className="tp-toggle" />
                <span data-i18n="reduceOnly">Reduce Only</span>
              </label>
              <label className="tp-check">
                <input
                  type="checkbox"
                  id="chkTpSl"
                  onChange={(e) =>
                    document
                      .getElementById("tpslInputs")
                      ?.classList.toggle("hidden", !e.target.checked)
                  }
                />
                <span className="tp-toggle" />
                <span data-i18n="tpsl">Take Profit / Stop Loss</span>
              </label>
              <div id="tpslInputs" className="hidden tp-tpsl-inputs">
                <div className="tp-tpsl-field">
                  <label className="tp-tpsl-label" htmlFor="tpPrice">
                    <span className="tpsl-dot tp"></span>Take Profit
                  </label>
                  <input
                    id="tpPrice"
                    type="number"
                    placeholder="Price"
                    min={0}
                    className="tp-tpsl-input"
                  />
                </div>
                <div className="tp-tpsl-field">
                  <label className="tp-tpsl-label" htmlFor="slPrice">
                    <span className="tpsl-dot sl"></span>Stop Loss
                  </label>
                  <input
                    id="slPrice"
                    type="number"
                    placeholder="Price"
                    min={0}
                    className="tp-tpsl-input"
                  />
                </div>
              </div>
            </div>
            <button
              id="tradeBtn"
              className="tp-action-btn tp-connect-bg"
              onClick={() => (window as any).rdo?.submitTrade()}
            >
              Connect
            </button>
            <div id="tradeErr" className="tp-err hidden"></div>
            <div className="flex flex-col gap-[7px] rounded-lg bg-[#0a0a0a] border border-[#1c1c1c] px-3 py-2.5 mt-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--hl-text-secondary)]" data-i18n="liqPrice">Liquidation Price</span>
                <span className="text-[var(--hl-text-soft)]" id="stLiq">N/A</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--hl-text-secondary)]" data-i18n="orderValue">Order Value</span>
                <span className="text-[var(--hl-text-soft)]" id="stVal">N/A</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--hl-text-secondary)]" data-i18n="marginRequired">Margin Required</span>
                <span className="text-[var(--hl-text-soft)]" id="stMargin">--</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--hl-text-secondary)]" data-i18n="slippage">Slippage</span>
                <span className="text-[var(--hl-text-soft)]" id="stSlip">--</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--hl-text-secondary)]" data-i18n="fee">Fee</span>
                <span className="text-[var(--hl-text-soft)]" id="stFee">0.0450% / 0.0150%</span>
              </div>
            </div>
            <div className="text-[9px] tracking-[0.8px] text-[#50d2c1] uppercase pt-3 pb-1" data-i18n="accountEquity">
              Account Equity
            </div>
            <div className="flex flex-col gap-[7px] rounded-lg bg-[#0a0a0a] border border-[#1c1c1c] px-3 py-2.5">
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--hl-text-secondary)]" data-i18n="spot">Spot</span>
                <span className="text-[var(--hl-text-soft)]" id="eqSpot">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="perps">Perps</a>
                <span className="text-[var(--hl-text-soft)]" id="eqPerps">$0.00</span>
              </div>
            </div>
            <div className="text-[9px] tracking-[0.8px] text-[#50d2c1] uppercase pt-3 pb-1" data-i18n="perpsOverview">
              Perps Overview
            </div>
            <div className="flex flex-col gap-[7px] rounded-lg bg-[#0a0a0a] border border-[#1c1c1c] px-3 py-2.5">
              <div className="flex justify-between text-[11px]">
                <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="balance">Balance</a>
                <span className="text-[var(--hl-text-soft)]" id="ovBalance">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--hl-text-secondary)]" data-i18n="unrealizedPnl">Unrealized PnL</span>
                <span className="text-[var(--hl-text-soft)]" id="ovPnl">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-[var(--hl-text-secondary)]" data-i18n="crossMarginRatio">Cross Margin Ratio</span>
                <span className="text-[var(--hl-text-soft)]" id="ovCmr">0.00%</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="maintenanceMargin">Maintenance Margin</a>
                <span className="text-[var(--hl-text-soft)]" id="ovMm">$0.00</span>
              </div>
              <div className="flex justify-between text-[11px]">
                <a href="#" className="tp-link text-[var(--hl-text-secondary)] no-underline font-semibold hover:text-[var(--hl-accent)]" data-i18n="crossAccountLev">Cross Account Leverage</a>
                <span className="text-[var(--hl-text-soft)]" id="ovLev">0.00x</span>
              </div>
            </div>
          </div>
        </aside>
    </>
  );
}
