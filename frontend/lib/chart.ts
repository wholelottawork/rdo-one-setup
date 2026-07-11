let priceChart: any;
let candleSeries: any;
let candles: any[]  = [];
let symbol   = 'BTC';

export async function initChart() {
  const priceEl = document.getElementById('priceChart');
  if (!priceEl) return;

  const { createChart, CandlestickSeries, CrosshairMode, LineStyle } = await import('lightweight-charts');

  if (priceChart) { try { priceChart.remove(); } catch {} priceChart = null; }
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
}

export function setCandles(data: any[], sym: string) {
  candles = data; symbol = sym;
  if (!candleSeries || !data.length) return;
  const tvCandles = data.map(c => ({ time: c.t / 1000, open: c.o, high: c.h, low: c.l, close: c.c }));
  candleSeries.setData(tvCandles);
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
