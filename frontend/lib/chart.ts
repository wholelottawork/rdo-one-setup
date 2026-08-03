import { sma, ema, bollinger, rsi } from './indicators';

let priceChart: any;
let candleSeries: any;
let candles: any[]  = [];
let symbol   = 'BTC';

// Indicator overlays: name -> series (or an array of them, for Bollinger's
// three lines). Series are created on first toggle-on and destroyed on
// toggle-off, so an unused indicator costs nothing.
let seriesDefs: any = null;
const overlays: Record<string, any> = {};
const RSI_PANE = 1;
let menuBound = false;

export async function initChart() {
  const priceEl = document.getElementById('priceChart');
  if (!priceEl) return;

  const lwc = await import('lightweight-charts');
  const { createChart, CandlestickSeries, CrosshairMode, LineStyle } = lwc;
  seriesDefs = lwc;

  if (priceChart) { try { priceChart.remove(); } catch {} priceChart = null; }
  // Any series from a previous chart died with it — forget them so a toggle
  // doesn't try to remove a handle the new chart never knew about.
  for (const k of Object.keys(overlays)) delete overlays[k];
  priceEl.innerHTML = '';

  const pw = priceEl.offsetWidth  || 800;
  const ph = priceEl.offsetHeight || 500;

  priceChart = createChart(priceEl, {
    layout: {
      background: { color: '#000000' },
      textColor:  '#878c8f',
      fontFamily: "'Inter', system-ui, sans-serif",
      fontSize:   11,
    },
    grid: { vertLines: { visible: false }, horzLines: { visible: false } },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: 'rgba(80,210,193,0.4)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#50d2c1' },
      horzLine: { color: 'rgba(80,210,193,0.4)', width: 1, style: LineStyle.Dashed, labelBackgroundColor: '#50d2c1' },
    },
    rightPriceScale: { borderColor: '#1f1f1f', scaleMargins: { top: 0.06, bottom: 0.04 } },
    timeScale: { borderColor: '#1f1f1f', timeVisible: true, secondsVisible: false, barSpacing: 8, rightOffset: 5 },
    width: pw, height: ph,
    handleScroll:  { mouseWheel: true, pressedMouseMove: true },
    handleScale:   { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
  });

  candleSeries = priceChart.addSeries(CandlestickSeries, {
    upColor: '#1fa67d', downColor: '#ed7088', borderVisible: false, wickUpColor: '#1fa67d', wickDownColor: '#ed7088',
  });

  const ro = new ResizeObserver(entries => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (!width || !height) continue;
      if (entry.target === priceEl) priceChart.resize(width, height);
    }
  });
  ro.observe(priceEl);

  priceChart.subscribeCrosshairMove((param: any) => {
    if (!param.time || !param.seriesData) return;
    const data = param.seriesData.get(candleSeries);
    if (data) updateOhlcEl(data);
  });

  initIndicatorMenu();
}

// ── indicators ─────────────────────────────────────────────────────────────
// Volume rides the price pane on its own hidden scale; SMA/EMA/Bollinger
// share the price scale; RSI gets its own pane because 0–100 would flatten
// the candles if it shared theirs.
function buildOverlay(name: string) {
  const { LineSeries, HistogramSeries } = seriesDefs;
  const line = (color: string, paneIndex?: number) =>
    priceChart.addSeries(
      LineSeries,
      { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false },
      paneIndex,
    );

  if (name === 'volume') {
    const s = priceChart.addSeries(HistogramSeries, {
      priceScaleId: '', priceFormat: { type: 'volume' },
      priceLineVisible: false, lastValueVisible: false,
    });
    s.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    return s;
  }
  if (name === 'rsi') {
    const s = priceChart.addSeries(
      LineSeries,
      { color: '#c084fc', lineWidth: 1, priceLineVisible: false },
      RSI_PANE,
    );
    for (const [price, color] of [[70, '#ed7088'], [30, '#1fa67d']] as [number, string][])
      s.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true });
    try { priceChart.panes()[RSI_PANE]?.setStretchFactor(0.25); } catch {}
    return s;
  }
  if (name === 'boll') return [line('#4b6bd6'), line('#878c8f'), line('#4b6bd6')];
  return line(name === 'sma' ? '#f5c518' : '#38bdf8');
}

// One array of points per series the indicator draws. Nulls (warm-up bars)
// are dropped — lightweight-charts just starts the line later.
function calcOverlay(name: string): any[][] {
  const time = (c: any) => c.t / 1000;
  const closes = candles.map((c) => c.c);
  const pts = (vals: (number | null)[]) =>
    vals.flatMap((v, i) => (v === null ? [] : [{ time: time(candles[i]), value: v }]));

  if (name === 'volume')
    return [candles.map((c) => ({
      time: time(c), value: c.v ?? 0,
      color: c.c >= c.o ? 'rgba(31,166,125,0.4)' : 'rgba(237,112,136,0.4)',
    }))];
  if (name === 'sma') return [pts(sma(closes, 20))];
  if (name === 'ema') return [pts(ema(closes, 50))];
  if (name === 'rsi') return [pts(rsi(closes, 14))];
  const b = bollinger(closes, 20, 2);
  return [pts(b.upper), pts(b.mid), pts(b.lower)];
}

// lastOnly recomputes the whole array (200 bars — cheap) but only pushes the
// newest point, so a price tick doesn't re-upload every series.
function applyOverlays(lastOnly = false) {
  if (!candles.length) return;
  for (const name of Object.keys(overlays)) {
    const target = ([] as any[]).concat(overlays[name]);
    const data = calcOverlay(name);
    target.forEach((s, i) => {
      const d = data[i];
      if (!d?.length) return;
      if (lastOnly) s.update(d[d.length - 1]);
      else s.setData(d);
    });
  }
}

/** Toggle one indicator; returns whether it is now on. */
export function toggleIndicator(name: string): boolean {
  if (!priceChart || !seriesDefs) return false;
  if (overlays[name]) {
    ([] as any[]).concat(overlays[name]).forEach((s) => {
      try { priceChart.removeSeries(s); } catch {}
    });
    delete overlays[name];
    // Otherwise the empty pane keeps its slice of the chart height.
    if (name === 'rsi') try { priceChart.removePane(RSI_PANE); } catch {}
    return false;
  }
  overlays[name] = buildOverlay(name);
  applyOverlays();
  return true;
}

function initIndicatorMenu() {
  const btn = document.getElementById('indBtn');
  const menu = document.getElementById('indMenu');
  if (!btn || !menu || menuBound) return;
  menuBound = true;

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target as Node) && e.target !== btn) menu.classList.add('hidden');
  });
  menu.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('[data-ind]') as HTMLElement | null;
    if (!row) return;
    row.classList.toggle('on', toggleIndicator(row.dataset.ind!));
  });
}

export function setCandles(data: any[], sym: string) {
  candles = data; symbol = sym;
  if (!candleSeries || !data.length) return;
  const tvCandles = data.map(c => ({ time: c.t / 1000, open: c.o, high: c.h, low: c.l, close: c.c }));
  candleSeries.setData(tvCandles);
  applyOverlays();
  priceChart.timeScale().fitContent();
  updateOhlcEl(data[data.length - 1]);
}

export function pushTick(sym: string, px: number) {
  if (sym !== symbol || !candles.length || !candleSeries) return;
  const last = candles[candles.length - 1];
  last.c = px;
  if (px > last.h) last.h = px;
  if (px < last.l) last.l = px;
  candleSeries.update({ time: last.t / 1000, open: last.o, high: last.h, low: last.l, close: last.c });
  applyOverlays(true);
  updateOhlcEl(last);
}

function updateOhlcEl(c: any) {
  setEl('oO', fmt(c.open  ?? c.o));
  setEl('oH', fmt(c.high  ?? c.h));
  setEl('oL', fmt(c.low   ?? c.l));
  setEl('oC', fmt(c.close ?? c.c));
}

function setEl(id: string, val: string) {
  const e = document.getElementById(id);
  if (e) e.textContent = val;
}

function fmt(p: number): string {
  if (p === null || p === undefined || isNaN(p)) return '—';
  const a = Math.abs(p);
  if (a >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100)   return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 1)     return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return p.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 6 });
}
