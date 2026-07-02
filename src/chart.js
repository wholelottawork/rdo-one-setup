import {
  createChart,
  CandlestickSeries,
  CrosshairMode,
  LineStyle,
} from 'lightweight-charts';

// ── theme ─────────────────────────────────────────────────────
const THEME = {
  layout: {
    background: { color: '#0f1a1e' },
    textColor:  '#878c8f',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize:   11,
  },
  grid: {
    vertLines: { color: '#1b2429', style: LineStyle.Solid },
    horzLines: { color: '#1b2429', style: LineStyle.Solid },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: {
      color:         'rgba(80,210,193,0.4)',
      width:         1,
      style:         LineStyle.Dashed,
      labelBackgroundColor: '#50d2c1',
    },
    horzLine: {
      color:         'rgba(80,210,193,0.4)',
      width:         1,
      style:         LineStyle.Dashed,
      labelBackgroundColor: '#50d2c1',
    },
  },
  rightPriceScale: {
    borderColor:    '#273035',
    scaleMargins:   { top: 0.06, bottom: 0.04 },
  },
  timeScale: {
    borderColor:    '#273035',
    timeVisible:    true,
    secondsVisible: false,
    barSpacing:     8,
    rightOffset:    5,
  },
};

// ── state ─────────────────────────────────────────────────────
let priceChart;
let candleSeries;
let candles  = [];
let symbol   = 'BTC';
let lastPx   = null;

// ── init ──────────────────────────────────────────────────────
export function initChart() {
  const priceEl = document.getElementById('priceChart');
  if (!priceEl) return;

  // Tear down any prior instance (HMR / re-init guard)
  if (priceChart) { try { priceChart.remove(); } catch {} priceChart = null; }
  priceEl.innerHTML = '';

  const pw = priceEl.offsetWidth  || 800;
  const ph = priceEl.offsetHeight || 500;

  // ── Price chart ──────────────────────────────────────────────
  priceChart = createChart(priceEl, {
    ...THEME,
    width:  pw,
    height: ph,
    handleScroll:  { mouseWheel: true, pressedMouseMove: true },
    handleScale:   { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  candleSeries = priceChart.addSeries(CandlestickSeries, {
    upColor:      '#1fa67d',
    downColor:    '#ed7088',
    borderVisible: false,
    wickUpColor:   '#1fa67d',
    wickDownColor: '#ed7088',
  });

  // Observe container size changes and forward to chart
  const ro = new ResizeObserver(entries => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (!width || !height) continue;
      if (entry.target === priceEl) priceChart.resize(width, height);
    }
  });
  ro.observe(priceEl);

  priceChart.subscribeCrosshairMove(param => {
    updateOhlcFromCrosshair(param);
  });

}

// ── load candle data ──────────────────────────────────────────
export function setCandles(data, sym) {
  candles = data;
  symbol  = sym;
  if (!candleSeries || !data.length) return;

  // price + volume
  const tvCandles = data.map(c => ({
    time:  (c.t / 1000),
    open:  c.o,
    high:  c.h,
    low:   c.l,
    close: c.c,
  }));

  candleSeries.setData(tvCandles);
  priceChart.timeScale().fitContent();

  // update OHLC display from last candle
  lastPx = data[data.length - 1].c;
  updateOhlcEl(data[data.length - 1]);
  updateMark(lastPx, data);
}

// ── real-time tick ────────────────────────────────────────────
export function pushTick(sym, px) {
  if (sym !== symbol || !candles.length || !candleSeries) return;
  const last = candles[candles.length - 1];
  last.c = px;
  if (px > last.h) last.h = px;
  if (px < last.l) last.l = px;
  lastPx = px;

  candleSeries.update({
    time:  (last.t / 1000),
    open:  last.o,
    high:  last.h,
    low:   last.l,
    close: last.c,
  });

  updateOhlcEl(last);
  updateMark(px, candles);
}

// ── crosshair OHLC display ────────────────────────────────────
function updateOhlcFromCrosshair(param) {
  if (!param.time || !param.seriesData) return;
  const data = param.seriesData.get(candleSeries);
  if (data) updateOhlcEl(data);
}

function updateOhlcEl(c) {
  el('oO', fmt(c.open  ?? c.o));
  el('oH', fmt(c.high  ?? c.h));
  el('oL', fmt(c.low   ?? c.l));
  el('oC', fmt(c.close ?? c.c));
}

function updateMark(px, candles) {
  el('statMark', fmt(px));
  if (candles.length >= 2) {
    const prev = candles[0].o;
    const chg  = px - prev;
    const pct  = prev ? (chg / prev * 100) : 0;
    const sign = chg >= 0 ? '+' : '';
    const chgEl = document.getElementById('statChange');
    if (chgEl) {
      chgEl.textContent = `${sign}${fmt(chg)} / ${sign}${pct.toFixed(2)}%`;
      chgEl.className   = 'hdr-stat-val ' + (chg >= 0 ? 'up' : 'down');
    }
  }
}

// ── helpers ───────────────────────────────────────────────────
function el(id, val) {
  const e = document.getElementById(id);
  if (e) e.textContent = val;
}

function fmt(p) {
  if (p === null || p === undefined || isNaN(p)) return '—';
  const a = Math.abs(p);
  if (a >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100)   return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 1)     return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return p.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 6 });
}
