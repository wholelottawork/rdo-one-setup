'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from './hyperliquid';

const THEME = {
  layout: {
    background: { color: '#0f1a1e' },
    textColor: '#878c8f',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 11,
  },
  grid: {
    vertLines: { visible: false },
    horzLines: { visible: false },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: 'rgba(80,210,193,0.4)', width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: '#50d2c1' },
    horzLine: { color: 'rgba(80,210,193,0.4)', width: 1 as const, style: LineStyle.Dashed, labelBackgroundColor: '#50d2c1' },
  },
  rightPriceScale: {
    borderColor: '#273035',
    scaleMargins: { top: 0.06, bottom: 0.04 },
  },
  timeScale: {
    borderColor: '#273035',
    timeVisible: true,
    secondsVisible: false,
    barSpacing: 8,
    rightOffset: 5,
  },
};

export interface Ohlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * Wraps lightweight-charts (a canvas-based lib that renders outside React's
 * tree) — ported from src/chart.js. `setCandles`/`pushTick` are imperative,
 * like the original; OHLC hover display is the one piece lifted into React
 * state (`ohlc`) since a component needs to render it.
 */
export function useLightweightChart(containerRef: React.RefObject<HTMLDivElement | null>) {
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const symbolRef = useRef<string>('');
  const [ohlc, setOhlc] = useState<Ohlc | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const chart = createChart(el, {
      ...THEME,
      width: el.offsetWidth || 800,
      height: el.offsetHeight || 500,
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#1fa67d',
      downColor: '#ed7088',
      borderVisible: false,
      wickUpColor: '#1fa67d',
      wickDownColor: '#ed7088',
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width && height) chart.resize(width, height);
      }
    });
    ro.observe(el);

    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData) return;
      const data = param.seriesData.get(series) as Partial<Ohlc> | undefined;
      if (data && data.open != null) {
        setOhlc({ open: data.open, high: data.high!, low: data.low!, close: data.close! });
      }
    });

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [containerRef]);

  const setCandles = useCallback((data: Candle[], sym: string) => {
    candlesRef.current = data;
    symbolRef.current = sym;
    const series = seriesRef.current;
    if (!series || !data.length) return;

    series.setData(data.map(c => ({
      time: (c.t / 1000) as UTCTimestamp, open: c.o, high: c.h, low: c.l, close: c.c,
    })));
    chartRef.current?.timeScale().fitContent();

    const last = data[data.length - 1];
    setOhlc({ open: last.o, high: last.h, low: last.l, close: last.c });
  }, []);

  const pushTick = useCallback((sym: string, px: number) => {
    const candles = candlesRef.current;
    if (sym !== symbolRef.current || !candles.length || !seriesRef.current) return;

    const last = candles[candles.length - 1];
    last.c = px;
    if (px > last.h) last.h = px;
    if (px < last.l) last.l = px;

    seriesRef.current.update({ time: (last.t / 1000) as UTCTimestamp, open: last.o, high: last.h, low: last.l, close: last.c });
    setOhlc({ open: last.o, high: last.h, low: last.l, close: last.c });
  }, []);

  return { setCandles, pushTick, ohlc };
}
