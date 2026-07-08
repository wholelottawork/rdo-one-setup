'use client';

import { useEffect, useRef } from 'react';
import { useTranslation } from '@/lib/i18n';
import { useLightweightChart } from '@/lib/chart';
import { ivLabel, type TradeMode } from '@/lib/markets';
import type { Candle } from '@/lib/hyperliquid';

const INTERVALS = [1, 3, 5, 15, 60, 240, 1440];

interface Props {
  mode: TradeMode;
  market: string;
  intervalMinutes: number;
  candles: Candle[] | undefined;
  livePrice: number | undefined;
  onIntervalChange: (iv: number) => void;
}

function fmtOhlc(p: number | undefined): string {
  if (p === null || p === undefined || isNaN(p)) return '—';
  const a = Math.abs(p);
  if (a >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return p.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 6 });
}

// Chart column — verbatim structure from index.html (sub-header with label +
// OHLC + interval buttons + Indicators, draw-tools rail, chart canvas).
export function ChartColumn({ mode, market, intervalMinutes, candles, livePrice, onIntervalChange }: Props) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const { setCandles, pushTick, ohlc } = useLightweightChart(containerRef);

  useEffect(() => {
    if (candles && candles.length) setCandles(candles, market);
  }, [candles, market, setCandles]);

  useEffect(() => {
    if (livePrice) pushTick(market, livePrice);
  }, [livePrice, market, pushTick]);

  const suffix = mode === 'aster' ? 'USDT' : 'USD';

  return (
    <section className="chart-col">
      {/* chart sub-header */}
      <div className="chart-subhdr">
        <div className="chart-subhdr-left">
          <span id="chartLabel" className="chart-label">{market}{suffix} · {ivLabel(intervalMinutes)} · RDO ONE</span>
          <span id="chartOhlc" className="chart-ohlc">
            O <b id="oO">{fmtOhlc(ohlc?.open)}</b>&nbsp; H <b id="oH">{fmtOhlc(ohlc?.high)}</b>&nbsp; L <b id="oL">{fmtOhlc(ohlc?.low)}</b>&nbsp; C <b id="oC">{fmtOhlc(ohlc?.close)}</b>
          </span>
        </div>
        <div className="chart-intervals">
          {INTERVALS.map(iv => (
            <button
              key={iv}
              className={`iv-btn${iv === intervalMinutes ? ' active' : ''}`}
              onClick={() => onIntervalChange(iv)}
            >
              {ivLabel(iv)}
            </button>
          ))}
        </div>
        <div className="chart-subhdr-tools">
          <button className="chart-tool-btn" title="Indicators">⊞ <span>{t('indicators')}</span></button>
        </div>
      </div>

      {/* chart draw tools + canvas */}
      <div className="chart-body">
        <div className="draw-tools">
          <button className="dt" title="Cursor">✛</button>
          <button className="dt" title="Crosshair">⊕</button>
          <div className="dt-sep"></div>
          <button className="dt" title="Trend line">╱</button>
          <button className="dt" title="Horizontal line">—</button>
          <button className="dt" title="Rectangle">▭</button>
          <button className="dt" title="Fibonacci">∿</button>
          <div className="dt-sep"></div>
          <button className="dt" title="Text">T</button>
          <div className="dt-sep"></div>
          <button className="dt" title="Magnet">⊙</button>
        </div>

        <div className="canvas-wrap" id="priceChart" ref={containerRef}></div>
      </div>
    </section>
  );
}
