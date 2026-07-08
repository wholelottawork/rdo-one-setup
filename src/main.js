import { showToast } from './toast.js';
import {
  connectWallet, connectExtension, connectAntarctic,
  closeWalletModal, closeWalletModalForce,
  getEVMAddress, getEVMProvider,
} from './wallet.js';
import { openOnramp, closeOnramp, closeOnrampForce } from './onramp.js';
import {
  loadBalance, getPositions, getMarketPrice,
  getCandles, openPosition, closePosition, cancelOrder,
  startPriceStream, getMetaAndAssetCtxs,
  getUserFills, getOpenOrders, getFundingHistory,
  getL2Book, startBookStream,
} from './trading.js';
import { initChart, setCandles, pushTick } from './chart.js';
import { openDepositModal, closeDepositModal } from './deposit.js';
import { t, setLang, getLang, applyTranslations } from './i18n.js';

// ── Markets ───────────────────────────────────────────────────
const HL_MARKETS = [
  'BTC','ETH','SOL','BNB','XRP','ADA','AVAX','DOGE','LINK','DOT',
  'UNI','ATOM','LTC','PEPE','WIF','BONK','JUP','ARB','OP','SUI',
  'APT','INJ','SEI','TIA','GMX','PENDLE','BLUR','SHIB','FLOKI',
  'NEAR','FTM','MATIC','SAND','MANA','AXS','ENJ','CHZ','RUNE',
  'LDO','CRV','AAVE','MKR','SNX','COMP','1INCH','IMX','FIL','AR',
];

const ASTER_CRYPTO_MARKETS = [
  'BTC','ETH','SOL','BNB','XRP','DOGE','AVAX','ADA','LINK','DOT',
  'SUI','APT','INJ','ARB','OP','PEPE','WIF','NEAR','ATOM','UNI',
];

const ASTER_STOCK_MARKETS = [
  'NVDA','TSLA','AAPL','MSFT','GOOGL','AMZN','META','COIN','MSTR','AMD',
];

const ASTER_MARKETS = [...ASTER_CRYPTO_MARKETS];

const MARKETS = HL_MARKETS; // alias for current mode

const ASTER_API = '/aster-fapi';

let currentMode   = 'hl';   // 'hl' | 'aster'
let currentMarket = 'BTC';
let currentIv     = 1;
let isBuy         = true;
let livePrices    = {};
let metaCtxs      = {};
let marketLev     = {};
let recentTrades  = [];
let stopBook      = null;
const asterStats  = {}; // { [sym]: { chgPct, vol, fund8h, oi } }
const hlStats     = {}; // { [sym]: { chgPct, vol, fund8h, oi } }

// ── Mode switching ─────────────────────────────────────────────
async function switchMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  const hlBtn    = document.getElementById('modeBtnHL');
  const asterBtn = document.getElementById('modeBtnAster');

  if (mode === 'aster') {
    hlBtn.classList.remove('active');
    asterBtn.classList.add('active');
    document.body.classList.add('mode-aster');

    // Update leverage max to 1001
    const levInput = document.getElementById('levInput');
    if (levInput) { levInput.max = 200; levInput.value = Math.min(parseInt(levInput.value), 200); }

    // Fee display
    const feeEl = document.getElementById('stFee');
    if (feeEl) feeEl.textContent = '0.0400% Taker / 0.0000% Maker';

    // Switch market to BTC on Aster
    currentMarket = 'BTC';
    document.getElementById('mktSymbol').textContent = 'BTC-USDT';
    document.getElementById('sizeUnit').textContent  = 'BTC';

    // Clear stale HL trade feed
    recentTrades = [];
    document.getElementById('tradesList').innerHTML =
      '<div style="color:var(--hl-text-muted);font-size:11px;padding:8px;text-align:center">Aster live trades streaming<br>coming soon</div>';

    rebuildDropdown();
    await loadMarket(currentMarket);
    fetchAsterMids();
    fetchAsterFunding();
    fetchAsterOI();

  } else {
    asterBtn.classList.remove('active');
    hlBtn.classList.add('active');
    document.body.classList.remove('mode-aster');

    // Restore leverage max
    const levInput = document.getElementById('levInput');
    if (levInput) { levInput.max = 50; levInput.value = Math.min(parseInt(levInput.value), 50); }

    // Fee display
    const feeEl = document.getElementById('stFee');
    if (feeEl) feeEl.textContent = '0.0450% / 0.0150%';

    currentMarket = 'BTC';
    document.getElementById('mktSymbol').textContent = 'BTC-USDC';
    document.getElementById('sizeUnit').textContent  = 'BTC';

    rebuildDropdown();
    await loadMarket(currentMarket);
    loadMeta();
  }

  document.getElementById('chartLabel').textContent =
    `${currentMarket}${mode === 'aster' ? 'USDT' : 'USD'} · ${ivLabel(currentIv)} · RDO ONE`;
  updateTradeBtn();
}

function rebuildDropdown() {
  const markets = currentMode === 'aster' ? ASTER_MARKETS : HL_MARKETS;
  const list    = document.getElementById('mktList');
  renderMarketList(markets, list);
}

// ── Aster public market data ───────────────────────────────────
async function fetchAsterMids() {
  if (currentMode !== 'aster') return;
  try {
    const res  = await fetch(`${ASTER_API}/fapi/v1/ticker/24hr`);
    const data = await res.json();
    if (!Array.isArray(data)) return;

    data.forEach(t => {
      const sym = t.symbol?.replace('USDT', '');
      if (!sym) return;
      const price = parseFloat(t.lastPrice ?? 0);
      if (price > 0) livePrices[sym] = price;

      asterStats[sym] = asterStats[sym] || {};
      asterStats[sym].chgPct = parseFloat(t.priceChangePercent ?? 0);
      asterStats[sym].vol    = parseFloat(t.quoteVolume ?? 0);

      const priceEl = document.getElementById(`mprice-${sym}`);
      if (priceEl) priceEl.textContent = fmtAster(price, sym);
    });

    // Update header stats if current market is Aster
    const ticker = data.find(t => t.symbol === currentMarket + 'USDT');
    if (ticker) updateAsterHeaderStats(ticker);

  } catch {}
  setTimeout(fetchAsterMids, 5000);
}

async function fetchAsterFunding() {
  if (currentMode !== 'aster') return;
  try {
    const res  = await fetch(`${ASTER_API}/fapi/v1/premiumIndex`);
    const data = await res.json();
    if (!Array.isArray(data)) return;
    data.forEach(t => {
      const sym = t.symbol?.replace('USDT', '');
      if (!sym) return;
      asterStats[sym] = asterStats[sym] || {};
      asterStats[sym].fund8h = parseFloat(t.lastFundingRate ?? 0) * 100;
    });
    rebuildDropdown();
  } catch {}
  setTimeout(fetchAsterFunding, 30000);
}

async function fetchAsterOI() {
  if (currentMode !== 'aster') return;
  try {
    await Promise.all(ASTER_MARKETS.map(async sym => {
      const res = await fetch(`${ASTER_API}/fapi/v1/openInterest?symbol=${sym}USDT`);
      const d   = await res.json();
      const oi  = parseFloat(d.openInterest ?? 0);
      asterStats[sym] = asterStats[sym] || {};
      asterStats[sym].oi = oi * (livePrices[sym] || 0);
    }));
    rebuildDropdown();
  } catch {}
  setTimeout(fetchAsterOI, 30000);
}


function updateAsterHeaderStats(ticker) {
  const px     = parseFloat(ticker.lastPrice  ?? 0);
  const open   = parseFloat(ticker.openPrice  ?? px);
  const chg    = px - open;
  const pct    = open ? (chg / open) * 100 : 0;
  const vol    = parseFloat(ticker.quoteVolume ?? 0);

  document.getElementById('statMark').textContent = fmtAster(px, currentMarket);

  const chgEl = document.getElementById('statChange');
  chgEl.textContent = `${chg >= 0 ? '+' : ''}${fmtAster(chg, currentMarket)} / ${chg >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  chgEl.className   = 'hdr-stat-val ' + (chg >= 0 ? 'up' : 'down');

  document.getElementById('statVolume').textContent = '$' + fmtLarge(vol);
  document.getElementById('statFunding').textContent = '— / —';
}

function fmtAster(n, sym) {
  if (isNaN(n) || n === 0) return '—';
  const stocks = ASTER_STOCK_MARKETS;
  if (stocks.includes(sym)) {
    return n >= 100 ? n.toFixed(2) : n.toPrecision(4);
  }
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (n >= 1)    return n.toFixed(2);
  return n.toPrecision(4);
}

// ── Aster candles ──────────────────────────────────────────────
async function getAsterCandles(symbol, intervalMin, count = 200) {
  const ivMap = { 1:'1m', 3:'3m', 5:'5m', 15:'15m', 60:'1h', 240:'4h', 1440:'1d' };
  const iv    = ivMap[intervalMin] || '1m';
  try {
    const res  = await fetch(
      `${ASTER_API}/fapi/v1/klines?symbol=${symbol}USDT&interval=${iv}&limit=${count}`
    );
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(c => ({
      t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5],
    }));
  } catch { return []; }
}

// ── Aster order book ───────────────────────────────────────────
async function getAsterBook(symbol) {
  try {
    const res  = await fetch(`${ASTER_API}/fapi/v1/depth?symbol=${symbol}USDT&limit=20`);
    const data = await res.json();
    return {
      asks: (data.asks || []).map(([px, sz]) => ({ px: +px, sz: +sz })),
      bids: (data.bids || []).map(([px, sz]) => ({ px: +px, sz: +sz })),
    };
  } catch { return { asks: [], bids: [] }; }
}

// ── Init ──────────────────────────────────────────────────────
async function init() {
  initChart();
  startClock();
  buildMarketDropdown();
  bindIntervals();
  bindBtmTabs();
  bindMarketBtn();
  initLang();
  await loadMarket('BTC');
  await loadMeta();

  startPriceStream(HL_MARKETS.slice(0, 20), onPrice, null, onTrade);
}

// ── Market meta ────────────────────────────────────────────────
async function loadMeta() {
  const data = await getMetaAndAssetCtxs();
  if (!data) return;
  data.forEach((ctx, sym) => { metaCtxs[sym] = ctx; });
  updateHeaderStats();
}

function updateHeaderStats() {
  const ctx = metaCtxs[currentMarket];
  if (!ctx) return;

  const px   = livePrices[currentMarket] ?? 0;
  const open = ctx.prevDayPx ?? px;
  const chg  = px - open;
  const pct  = open ? (chg / open) * 100 : 0;

  document.getElementById('statMark').textContent   = fmt(px, currentMarket);

  const chgEl = document.getElementById('statChange');
  chgEl.textContent = `${chg >= 0 ? '+' : ''}${fmt(chg, currentMarket)} / ${chg >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  chgEl.className   = 'hdr-stat-val ' + (chg >= 0 ? 'up' : 'down');

  document.getElementById('statVolume').textContent =
    '$' + fmtLarge(ctx.dayNtlVlm ?? 0);

  document.getElementById('statFunding').textContent =
    (ctx.funding * 100).toFixed(4) + '% / ' + countdown();
}

function countdown() {
  const now  = new Date();
  const next = new Date(now);
  next.setUTCHours(Math.ceil((now.getUTCHours() + 1) / 8) * 8, 0, 0, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 8);
  const diff = next - now;
  const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
  const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
  const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
  return `${h}:${m}:${s}`;
}

// ── Market dropdown ────────────────────────────────────────────
function buildMarketDropdown() {
  renderMarketList(MARKETS, document.getElementById('mktList'));
  fetchAllMids();
}

async function fetchAllMids() {
  try {
    const r = await fetch('/api/hl/info', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    const [meta, ctxs] = await r.json();
    meta.universe.forEach((asset, i) => {
      const sym   = asset.name;
      const ctx   = ctxs[i] ?? {};
      const price = parseFloat(ctx.markPx ?? 0);
      if (asset.maxLeverage) marketLev[sym] = asset.maxLeverage;
      if (!price) return;
      livePrices[sym] = price;
      const prev = parseFloat(ctx.prevDayPx ?? price);
      hlStats[sym] = {
        chgPct: prev ? (price - prev) / prev * 100 : 0,
        vol:    parseFloat(ctx.dayNtlVlm  ?? 0),
        fund8h: parseFloat(ctx.funding    ?? 0) * 100,
        oi:     parseFloat(ctx.openInterest ?? 0) * price,
      };
      const priceEl = document.getElementById(`mprice-${sym}`);
      if (priceEl) priceEl.textContent = fmt(price, sym);
      const levEl = document.getElementById(`mlev-${sym}`);
      if (levEl) levEl.textContent = asset.maxLeverage + 'x';
    });
  } catch {}
  setTimeout(fetchAllMids, 5000);
}

function renderMarketList(markets, list) {
  const dd        = document.getElementById('mktDropdown');
  const isAster   = currentMode === 'aster';
  const mktSuffix = isAster ? '-USDT' : '-USDC';
  const getLev    = sym => isAster
    ? '200x'
    : (marketLev[sym] ? marketLev[sym] + 'x' : '');
  const getPrice  = sym => livePrices[sym]
    ? (isAster ? fmtAster(livePrices[sym], sym) : fmt(livePrices[sym], sym))
    : '—';
  const fmtFund = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(4)}%`;
  const fmtChg  = v => v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

  dd.classList.add('mkt-wide');
  const colHdr = `<div class="mkt-col-hdr">
    <span>${t('market')}</span><span>${t('lastPrice')}</span><span>${t('change24hShort')}</span><span>${t('funding8h')}</span><span>${t('volume')}</span><span>${t('openInterest')}</span>
  </div>`;
  list.innerHTML = colHdr + markets.map(sym => {
    const s       = (isAster ? asterStats : hlStats)[sym] || {};
    const chgCls  = (s.chgPct ?? 0) >= 0 ? 'up' : 'dn';
    const fundCls = (s.fund8h ?? 0) >= 0 ? 'up' : 'dn';
    return `<div class="mkt-item mkt-item-wide" data-sym="${sym}">
      <span class="mkt-item-name">${sym}${mktSuffix}<span class="mkt-item-lev" id="mlev-${sym}">${getLev(sym)}</span></span>
      <span class="mkt-item-price" id="mprice-${sym}">${getPrice(sym)}</span>
      <span class="${chgCls}">${fmtChg(s.chgPct)}</span>
      <span class="${fundCls}">${fmtFund(s.fund8h)}</span>
      <span>${s.vol != null ? '$' + fmtLarge(s.vol) : '—'}</span>
      <span>${s.oi  != null ? '$' + fmtLarge(s.oi)  : '—'}</span>
    </div>`;
  }).join('');

  list.querySelectorAll('.mkt-item').forEach(el =>
    el.addEventListener('click', () => { selectMarket(el.dataset.sym); closeDropdown(); })
  );
}

function bindMarketBtn() {
  const btn  = document.getElementById('mktBtn');
  const dd   = document.getElementById('mktDropdown');
  const srch = document.getElementById('mktSearch');

  const backdrop = document.getElementById('mktBackdrop');

  function openDropdown() {
    dd.classList.remove('hidden');
    backdrop.classList.remove('hidden');
    srch.focus();
    document.getElementById('modePopup')?.classList.add('hidden');
    document.getElementById('modeBackdrop')?.classList.add('hidden');
  }

  btn.addEventListener('click', e => {
    e.stopPropagation();
    if (dd.classList.contains('hidden')) openDropdown();
    else closeDropdown();
  });

  backdrop.addEventListener('click', () => closeDropdown());

  srch.addEventListener('input', () => {
    const q       = srch.value.toLowerCase();
    const markets = currentMode === 'aster' ? ASTER_MARKETS : HL_MARKETS;
    renderMarketList(markets.filter(s => s.toLowerCase().includes(q)), document.getElementById('mktList'));
    focusedIdx = -1;
  });

  let focusedIdx = -1;

  function getItems() { return [...document.getElementById('mktList').querySelectorAll('.mkt-item')]; }

  function setFocus(idx) {
    const items = getItems();
    items.forEach(el => el.classList.remove('mkt-focused'));
    if (idx < 0 || idx >= items.length) { focusedIdx = -1; return; }
    focusedIdx = idx;
    items[idx].classList.add('mkt-focused');
    items[idx].scrollIntoView({ block: 'nearest' });
  }

  srch.addEventListener('keydown', e => {
    const items = getItems();
    if (e.key === 'ArrowDown')  { e.preventDefault(); setFocus(Math.min(focusedIdx + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setFocus(Math.max(focusedIdx - 1, 0)); }
    else if (e.key === 'Enter' && focusedIdx >= 0) { selectMarket(items[focusedIdx].dataset.sym); closeDropdown(); }
    else if (e.key === 'Escape') closeDropdown();
  });

  document.addEventListener('click', e => {
    if (!dd.contains(e.target) && e.target !== btn) closeDropdown();
  });
}

function closeDropdown() {
  document.getElementById('mktDropdown').classList.add('hidden');
  document.getElementById('mktBackdrop').classList.add('hidden');
  document.getElementById('mktSearch').value = '';
  rebuildDropdown();
}

async function selectMarket(sym) {
  currentMarket = sym;
  const suffix  = currentMode === 'aster' ? '-USDT' : '-USDC';
  const chartSuffix = currentMode === 'aster' ? 'USDT' : 'USD';
  document.getElementById('mktSymbol').textContent  = sym + suffix;
  document.getElementById('chartLabel').textContent = `${sym}${chartSuffix} · ${ivLabel(currentIv)} · RDO ONE`;
  document.getElementById('sizeUnit').textContent   = sym;
  updateTradeBtn();
  await loadMarket(sym);
}

async function loadMarket(sym) {
  const suffix = currentMode === 'aster' ? '-USDT' : '-USDC';
  const pairEl = document.getElementById('tradesPair');
  if (pairEl) pairEl.textContent = sym + suffix;
  const xtEl = document.getElementById('xtTicker');
  if (xtEl) xtEl.textContent = sym;

  if (currentMode === 'aster') {
    const data = await getAsterCandles(sym, currentIv, 200);
    setCandles(data, sym);

    // Order book via Aster public REST (no streaming for now)
    stopBook?.();
    stopBook = null;
    getAsterBook(sym).then(book => renderOrderBook(sym, book));

    // Refresh order book every 2s while in Aster mode
    stopBook = setInterval(async () => {
      if (currentMode !== 'aster' || currentMarket !== sym) { clearInterval(stopBook); return; }
      const book = await getAsterBook(sym);
      renderOrderBook(sym, book);
    }, 2000);

  } else {
    const data = await getCandles(sym, currentIv, 200);
    setCandles(data, sym);
    updateHeaderStats();

    stopBook?.();
    getL2Book(sym).then(book => renderOrderBook(sym, book));
    stopBook = startBookStream(sym, renderOrderBook);
  }
}

function renderOrderBook(sym, { asks, bids }) {
  if (sym !== currentMarket) return;

  const fmtPx = n => n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 2 });
  const fmtSz = n => n >= 1 ? n.toFixed(2) : n >= 0.001 ? n.toFixed(3) : n.toFixed(4);

  // Build cumulative rows (asks lowest-first, bids highest-first)
  const sortedAsks = [...asks].sort((a, b) => a.px - b.px);
  const sortedBids = [...bids].sort((a, b) => b.px - a.px);
  let ca = 0, cb = 0;
  const cumAsks = sortedAsks.map(r => { ca += r.sz; return { ...r, cum: ca }; });
  const cumBids = sortedBids.map(r => { cb += r.sz; return { ...r, cum: cb }; });
  const maxCum  = Math.max(ca, cb) || 1;

  const row = (cls, { px, sz, cum }) => {
    const pct = (cum / maxCum * 100).toFixed(1);
    return `<div class="ob-row ${cls}"><span class="ob-price">${fmtPx(px)}</span><span class="ob-sz">${fmtSz(sz)}</span><span class="ob-total">${fmtSz(cum)}</span><div class="ob-depth" style="width:${pct}%"></div></div>`;
  };

  // Asks displayed bottom-to-top so lowest ask sits closest to spread
  const asksEl = document.getElementById('obAsks');
  if (asksEl) asksEl.innerHTML = cumAsks.map(r => row('ask', r)).join('');

  const bidsEl = document.getElementById('obBids');
  if (bidsEl) bidsEl.innerHTML = cumBids.map(r => row('bid', r)).join('');

  const totalVol = ca + cb || 1;
  const bidPct = (cb / totalVol * 100).toFixed(1);
  const askPct = (ca / totalVol * 100).toFixed(1);
  const ratioBid = document.getElementById('obRatioBid');
  const ratioAsk = document.getElementById('obRatioAsk');
  if (ratioBid) { ratioBid.style.width = bidPct + '%'; ratioBid.textContent = `B ${bidPct}%`; }
  if (ratioAsk) { ratioAsk.textContent = `${askPct}% S`; }

  const bestAsk = sortedAsks[0]?.px ?? 0;
  const bestBid = sortedBids[0]?.px ?? 0;
  if (bestAsk && bestBid) {
    const spread = bestAsk - bestBid;
    const sv = document.getElementById('obSpreadVal');
    const sp = document.getElementById('obSpreadPct');
    if (sv) sv.textContent = fmtPx(spread);
    if (sp) sp.textContent = (spread / bestBid * 100).toFixed(3) + '%';
  }
}

// ── Intervals ──────────────────────────────────────────────────
function bindIntervals() {
  document.querySelectorAll('.iv-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.iv-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentIv = parseInt(btn.dataset.iv);
      const suffix = currentMode === 'aster' ? 'USDT' : 'USD';
      document.getElementById('chartLabel').textContent =
        `${currentMarket}${suffix} · ${ivLabel(currentIv)} · RDO ONE`;
      if (currentMode === 'aster') {
        setCandles(await getAsterCandles(currentMarket, currentIv, 200), currentMarket);
      } else {
        setCandles(await getCandles(currentMarket, currentIv, 200), currentMarket);
      }
    });
  });
}

function ivLabel(iv) {
  if (iv < 60)   return iv + 'm';
  if (iv < 1440) return (iv / 60) + 'h';
  return '1D';
}

// ── Bottom tabs ────────────────────────────────────────────────
const btmPaneMap = {
  'positions':     'btPositions',
  'balances':      'btBalances',
  'open-orders':   'btOpenOrders',
  'trade-history': 'btTradeHistory',
  'funding':       'btFunding',
  'order-history': 'btOrderHistory',
  'liq-map':       'btLiqMap',
};

function bindBtmTabs() {
  document.querySelectorAll('.btm-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.btm-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      Object.values(btmPaneMap).forEach(id => { const el = document.getElementById(id); if (el) { el.classList.add('hidden'); el.style.display = ''; } });
      const activePane = document.getElementById(btmPaneMap[btn.dataset.bt]);
      if (activePane) { activePane.classList.remove('hidden'); if (btn.dataset.bt === 'liq-map') activePane.style.display = 'flex'; }
      if (btn.dataset.bt === 'liq-map') window.lmpOpen?.();

      // Load data for tabs that need it
      const addr = getEVMAddress();
      if (!addr) return;
      const tab = btn.dataset.bt;
      if (tab === 'trade-history') renderFills(await getUserFills(addr));
      if (tab === 'open-orders')   renderOpenOrders(await getOpenOrders(addr));
      if (tab === 'funding')       renderFundingHistory(await getFundingHistory(addr));
      if (tab === 'balances')      await refreshPositions(addr);
    });
  });
}

// ── Price stream callbacks ─────────────────────────────────────
function onPrice(sym, price) {
  livePrices[sym] = price;
  const el = document.getElementById(`mprice-${sym}`);
  if (el) el.textContent = fmt(price, sym);
  if (sym === currentMarket) { pushTick(sym, price); updateHeaderStats(); updateStats(); }
}

function onTrade(sym, trade) {
  if (sym !== currentMarket) return;
  recentTrades.unshift(trade);
  if (recentTrades.length > 80) recentTrades.pop();
  renderTrades();
}

// ── Trades rendering ───────────────────────────────────────────
function renderTrades() {
  document.getElementById('tradesList').innerHTML = recentTrades.slice(0, 50).map(t => {
    const d  = new Date(t.time);
    const ts = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map(n => n.toString().padStart(2, '0')).join(':');
    return `<div class="trade-row ${t.side === 'buy' ? 't-buy' : 't-sell'}">
      <span class="tr-price">${fmt(t.px, currentMarket)}</span>
      <span class="tr-sz">${fmtSz(t.sz)}</span>
      <span class="tr-time">${ts}</span>
    </div>`;
  }).join('');
}

// ── Trade history rendering ────────────────────────────────────
function renderFills(fills) {
  const el = document.getElementById('btTradeHistory');
  if (!fills.length) { el.innerHTML = '<div class="btm-empty">No trade history</div>'; return; }
  el.innerHTML = `
    <div class="btm-col-hdr" style="grid-template-columns:70px 60px 100px 80px 80px 80px 80px 1fr">
      <span>Market</span><span>Side</span><span>Price</span>
      <span>Size</span><span>Fee</span><span>PnL</span><span>Dir</span><span>Time</span>
    </div>` +
    fills.slice(0, 200).map(f => {
      const pnlCls = f.pnl > 0 ? 'pnl-pos' : f.pnl < 0 ? 'pnl-neg' : '';
      return `<div class="pos-row" style="grid-template-columns:70px 60px 100px 80px 80px 80px 80px 1fr">
        <span class="pos-sym">${f.coin}</span>
        <span class="${f.side === 'Buy' ? 'dir-long' : 'dir-short'}">${f.side}</span>
        <span>${fmt(f.price, f.coin)}</span>
        <span>${fmtSz(f.size)}</span>
        <span>$${f.fee.toFixed(4)}</span>
        <span class="${pnlCls}">${f.pnl !== 0 ? (f.pnl > 0 ? '+' : '') + '$' + f.pnl.toFixed(2) : '—'}</span>
        <span style="color:var(--hl-text-muted);font-size:10px">${f.dir}</span>
        <span style="color:var(--hl-text-muted)">${new Date(f.time).toLocaleString()}</span>
      </div>`;
    }).join('');
}

// ── Open orders rendering ──────────────────────────────────────
function renderOpenOrders(orders) {
  const el = document.getElementById('btOpenOrders');
  if (!orders.length) { el.innerHTML = '<div class="btm-empty">No open orders</div>'; return; }
  el.innerHTML = `
    <div class="btm-col-hdr" style="grid-template-columns:70px 60px 100px 80px 80px 1fr 60px">
      <span>Market</span><span>Side</span><span>Price</span>
      <span>Size</span><span>Filled</span><span>Time</span><span></span>
    </div>` +
    orders.map(o => {
      const filled = o.origSize - o.size;
      return `<div class="pos-row" style="grid-template-columns:70px 60px 100px 80px 80px 1fr 60px">
        <span class="pos-sym">${o.coin}</span>
        <span class="${o.side === 'Buy' ? 'dir-long' : 'dir-short'}">${o.side}</span>
        <span>${fmt(o.price, o.coin)}</span>
        <span>${fmtSz(o.size)}</span>
        <span>${fmtSz(filled)}</span>
        <span style="color:var(--hl-text-muted)">${new Date(o.time).toLocaleString()}</span>
        <span><button class="pos-close-btn" onclick="window.rdo.cancelOrd(${o.oid},'${o.coin}')">Cancel</button></span>
      </div>`;
    }).join('');
}

// ── Funding history rendering ──────────────────────────────────
function renderFundingHistory(rows) {
  const el = document.getElementById('btFunding');
  if (!rows.length) { el.innerHTML = '<div class="btm-empty">No funding history</div>'; return; }
  el.innerHTML = `
    <div class="btm-col-hdr" style="grid-template-columns:70px 80px 80px 80px 1fr">
      <span>Market</span><span>Payment</span><span>Rate</span><span>Size</span><span>Time</span>
    </div>` +
    rows.slice(0, 200).map(f => {
      const cls = f.usdc >= 0 ? 'pnl-pos' : 'pnl-neg';
      return `<div class="pos-row" style="grid-template-columns:70px 80px 80px 80px 1fr">
        <span class="pos-sym">${f.coin}</span>
        <span class="${cls}">${f.usdc >= 0 ? '+' : ''}$${f.usdc.toFixed(4)}</span>
        <span>${(f.rate * 100).toFixed(4)}%</span>
        <span>${fmtSz(Math.abs(f.size))}</span>
        <span style="color:var(--hl-text-muted)">${new Date(f.time).toLocaleString()}</span>
      </div>`;
    }).join('');
}

// ── Trade panel ────────────────────────────────────────────────
function setSide(buy) {
  isBuy = buy;
  document.getElementById('btnBuy').classList.toggle('active',  buy);
  document.getElementById('btnSell').classList.toggle('active', !buy);
  if (getEVMAddress()) {
    const btn = document.getElementById('tradeBtn');
    btn.className   = 'tp-action-btn ' + (buy ? 'tp-buy-bg' : 'tp-sell-bg');
    btn.textContent = (buy ? 'Buy / Long ' : 'Sell / Short ') + currentMarket;
  }
  updateStats();
}

function updateTradeBtn() {
  const addr = getEVMAddress();
  const btn  = document.getElementById('tradeBtn');
  if (!addr) { btn.textContent = 'Connect'; return; }
  btn.textContent = (isBuy ? 'Buy / Long ' : 'Sell / Short ') + currentMarket;
}

function updateStats() {
  const size     = parseFloat(document.getElementById('sizeInput').value) || 0;
  const lev      = parseFloat(document.getElementById('levInput').value)  || 20;
  const px       = livePrices[currentMarket] || 0;
  const notional = size * px;
  const margin   = notional / lev;
  const liqMove  = 0.975 / lev;
  const liqPx    = px ? (isBuy ? px * (1 - liqMove) : px * (1 + liqMove)) : 0;

  document.getElementById('stLiq').textContent    = liqPx   ? fmt(liqPx, currentMarket)            : 'N/A';
  document.getElementById('stVal').textContent    = notional ? '$' + fmtLarge(notional)              : 'N/A';
  document.getElementById('stMargin').textContent = margin   ? '$' + margin.toFixed(2)              : '--';
  const feeRate = currentMode === 'aster' ? 0.0004 : 0.00045;
  const feeLabel = currentMode === 'aster' ? '0.0400% Taker / 0.0000% Maker' : '0.0450% / 0.0150%';
  const feePct   = currentMode === 'aster' ? '0.0400%' : '0.0450%';
  document.getElementById('stFee').textContent    = notional
    ? '$' + (notional * feeRate).toFixed(4) + ' (' + feePct + ')'
    : feeLabel;
}

function onSlider(val) {
  const addr = getEVMAddress();
  if (!addr) return;
  const avail = parseFloat(document.getElementById('tpAvail').textContent.replace(/[^0-9.]/g, '')) || 0;
  const lev   = parseFloat(document.getElementById('levInput').value) || 20;
  const px    = livePrices[currentMarket] || 0;
  if (!px) return;
  document.getElementById('sizeInput').value = ((avail * lev * (val / 100)) / px).toFixed(6);
  updateStats();
}

async function submitTrade() {
  const addr = getEVMAddress();
  if (!addr) { await connectWalletFn(); return; }

  const size = parseFloat(document.getElementById('sizeInput').value);
  const lev  = parseFloat(document.getElementById('levInput').value) || 20;
  const px   = livePrices[currentMarket] || await getMarketPrice(currentMarket);
  if (!size || size <= 0) { showErr('Enter a size'); return; }

  const btn  = document.getElementById('tradeBtn');
  const orig = btn.textContent;
  btn.textContent = 'Confirming...';
  btn.disabled    = true;

  try {
    const { ethers } = await import('ethers');
    const signer = await new ethers.BrowserProvider(getEVMProvider()).getSigner();
    const result = await openPosition({ symbol: currentMarket, sizeDollars: size * px, leverage: lev, isLong: isBuy, signer });
    if (result.status === 'ok') {
      showToast(`${isBuy ? 'Long' : 'Short'} ${currentMarket} opened`, 'ok');
      setTimeout(() => refreshPositions(addr), 2000);
    } else {
      showErr(result.response ?? 'Order failed');
    }
  } catch (e) {
    showErr(e.message ?? 'Transaction failed');
  } finally {
    btn.textContent = orig;
    btn.disabled    = false;
  }
}

function showErr(msg) {
  const el = document.getElementById('tradeErr');
  el.textContent = msg;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 5000);
}

// ── Positions ──────────────────────────────────────────────────
async function refreshPositions(addr) {
  const [positions, balance] = await Promise.all([
    getPositions(addr),
    loadBalance(addr),
  ]);

  document.getElementById('tpAvail').textContent   = '$' + balance.toFixed(2) + ' USDC';
  document.getElementById('ovBalance').textContent = '$' + balance.toFixed(2);
  document.getElementById('eqPerps').textContent   = '$' + balance.toFixed(2);
  document.getElementById('balanceDisplay').textContent = '$' + balance.toFixed(2);

  const totalPnl = positions.reduce((s, p) => s + p.pnl, 0);
  document.getElementById('ovPnl').textContent =
    (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toFixed(2);

  const mine = positions.find(p => p.symbol === currentMarket);
  document.getElementById('tpCurPos').textContent = mine
    ? (mine.size >= 0 ? '+' : '') + mine.size.toFixed(5) + ' ' + currentMarket
    : '0.00000 ' + currentMarket;

  renderPositions(positions, addr);
}

function renderPositions(positions, addr) {
  const el = document.getElementById('posRows');
  if (!positions.length) {
    el.innerHTML = '<div class="btm-empty">No open positions yet</div>';
    return;
  }
  el.innerHTML = positions.map((p, i) => {
    const pnlCls = p.pnl >= 0 ? 'pnl-pos' : 'pnl-neg';
    const px     = livePrices[p.symbol] || p.entryPrice;
    const roe    = p.entryPrice
      ? ((px - p.entryPrice) / p.entryPrice * p.leverage * (p.isLong ? 1 : -1) * 100)
      : 0;
    const modeLbl = currentMode === 'aster' ? 'EXTRA' : 'BASIC';
    const modeCls = currentMode === 'aster' ? 'pos-mode-extra' : 'pos-mode-basic';
    return `<div class="pos-row">
      <span class="pos-sym">${p.symbol}</span>
      <span><span class="pos-mode-tag ${modeCls}">${modeLbl}</span></span>
      <span>${p.size.toFixed(4)}</span>
      <span>$${(Math.abs(p.size) * px).toFixed(2)}</span>
      <span>${fmt(p.entryPrice, p.symbol)}</span>
      <span>${fmt(px, p.symbol)}</span>
      <span class="${pnlCls}">${p.pnl >= 0 ? '+' : ''}$${p.pnl.toFixed(2)} (${roe.toFixed(2)}%)</span>
      <span>${fmt(p.liqPrice, p.symbol)}</span>
      <span>—</span><span>—</span>
      <span class="${p.isLong ? 'dir-long' : 'dir-short'}">${p.isLong ? 'Long' : 'Short'}</span>
      <span><button class="pos-close-btn" onclick="window.rdo.closePos(${i})">Close</button></span>
    </div>`;
  }).join('');
}

async function closePos(index) {
  const addr = getEVMAddress();
  if (!addr) return;
  const positions = await getPositions(addr);
  const p = positions[index];
  if (!p) return;
  try {
    const { ethers } = await import('ethers');
    const signer = await new ethers.BrowserProvider(getEVMProvider()).getSigner();
    const result = await closePosition({ symbol: p.symbol, size: p.size, isLong: p.isLong, signer });
    if (result.status === 'ok') {
      showToast('Position closed', 'ok');
      setTimeout(() => refreshPositions(addr), 2000);
    } else {
      showToast(result.response ?? 'Close failed', 'err');
    }
  } catch (e) {
    showToast(e.message, 'err');
  }
}

async function cancelOrd(oid, symbol) {
  const addr = getEVMAddress();
  if (!addr) return;
  try {
    const { ethers } = await import('ethers');
    const signer = await new ethers.BrowserProvider(getEVMProvider()).getSigner();
    const result = await cancelOrder({ oid, symbol, signer });
    if (result.status === 'ok') {
      showToast('Order cancelled', 'ok');
      renderOpenOrders(await getOpenOrders(addr));
    } else {
      showToast(result.response ?? 'Cancel failed', 'err');
    }
  } catch (e) {
    showToast(e.message, 'err');
  }
}

// ── Wallet connect ─────────────────────────────────────────────
async function connectWalletFn() {
  const addr = await connectWallet();
  if (addr) {
    const btn = document.getElementById('tradeBtn');
    btn.textContent = (isBuy ? 'Buy / Long ' : 'Sell / Short ') + currentMarket;
    btn.className   = 'tp-action-btn ' + (isBuy ? 'tp-buy-bg' : 'tp-sell-bg');
    await refreshPositions(addr);
    setInterval(() => refreshPositions(addr), 15000);
  }
  return addr;
}

// ── Clock ──────────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('clockEl');
  const t  = () => {
    el.textContent = new Date().toUTCString().slice(5, 25) + ' UTC';
    if (currentMode === 'hl') {
      const ctx = metaCtxs[currentMarket];
      if (ctx) document.getElementById('statFunding').textContent =
        (ctx.funding * 100).toFixed(4) + '% / ' + countdown();
    }
  };
  t(); setInterval(t, 1000);
}

// ── Formatting ─────────────────────────────────────────────────
function fmt(p, sym) {
  if (!p) return '—';
  if (p >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 100)   return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1)     return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return p.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 6 });
}

function fmtSz(n) {
  if (!n) return '0';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1)    return n.toFixed(4);
  return n.toFixed(6);
}

function fmtLarge(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

// ── Language ──────────────────────────────────────────────────
function initLang() {
  applyTranslations();
  const dd  = document.getElementById('langDropdown');
  const bdp = document.getElementById('langBackdrop');
  if (!dd) return;
  highlightLangOption();
  const closeLang = () => { dd.classList.add('hidden'); bdp?.classList.add('hidden'); };
  dd.querySelectorAll('.lang-option').forEach(btn => {
    btn.addEventListener('click', () => {
      setLang(btn.dataset.lang);
      highlightLangOption();
      closeLang();
      buildMarketDropdown();
    });
  });
  bdp?.addEventListener('click', closeLang);
  document.addEventListener('click', e => {
    if (!e.target.closest('.lang-wrap') && e.target !== bdp) closeLang();
  });
}
function toggleLangDropdown() {
  const dd  = document.getElementById('langDropdown');
  const bdp = document.getElementById('langBackdrop');
  const isHidden = dd?.classList.contains('hidden');
  dd?.classList.toggle('hidden');
  bdp?.classList.toggle('hidden', !isHidden);
}
function highlightLangOption() {
  const lang = getLang();
  document.querySelectorAll('.lang-option').forEach(b => {
    b.classList.toggle('active', b.dataset.lang === lang);
  });
}

// ── Public API ─────────────────────────────────────────────────
window.rdo = {
  connectWallet: connectWalletFn,
  switchMode,
  setSide,
  updateStats,
  onSlider,
  submitTrade,
  closePos,
  cancelOrd,
  openDeposit:       openDepositModal,
  closeDeposit:      closeDepositModal,
  connectExtension,
  connectAntarctic,
  closeWalletModal,
  closeWalletModalForce,
  openOnramp,
  closeOnramp,
  closeOnrampForce,
  connectX() {
    const btn = document.getElementById('xtConnectBtn');
    if (btn) { btn.textContent = 'Connected'; btn.disabled = true; }
    const feed = document.getElementById('xtFeed');
    if (feed) feed.innerHTML = '<div class="xt-empty">X integration coming soon — connect your API key in settings.</div>';
  },
  toggleOrderBook() {
    document.getElementById('obMini')?.classList.toggle('collapsed');
  },
  toggleLang: toggleLangDropdown,
  toggleModeHelp() {
    const popup    = document.getElementById('modePopup');
    const backdrop = document.getElementById('modeBackdrop');
    if (!popup) return;
    closeDropdown();
    const opening = popup.classList.contains('hidden');
    popup.classList.toggle('hidden', !opening);
    if (backdrop) backdrop.classList.toggle('hidden', !opening);
    if (opening) {
      const close = e => {
        if (!popup.contains(e.target) && e.target.id !== 'modeHelpBtn' && e.target.id !== 'modeBackdrop') return;
        popup.classList.add('hidden');
        if (backdrop) backdrop.classList.add('hidden');
        document.removeEventListener('click', close);
      };
      setTimeout(() => document.addEventListener('click', close), 0);
    }
  },
};

// ── X Tracker resize ───────────────────────────────────────────
(function initXtResize() {
  const handle = document.getElementById('xtResizeHandle');
  if (!handle) return;
  const root = document.documentElement;
  const MIN = 120, MAX = 520;
  let dragging = false, startX = 0, startW = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startX = e.clientX;
    startW = parseInt(getComputedStyle(root).getPropertyValue('--xt')) || 240;
    handle.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const w = Math.min(MAX, Math.max(MIN, startW + (e.clientX - startX)));
    root.style.setProperty('--xt', w + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

// ── Bottom panel vertical resize ───────────────────────────────
(function initBtmResize() {
  const handle = document.getElementById('btmResizeHandle');
  if (!handle) return;
  const root = document.documentElement;
  const MIN = 60, MAX = 480;
  let dragging = false, startY = 0, startH = 0;

  handle.addEventListener('mousedown', e => {
    dragging = true;
    startY = e.clientY;
    startH = parseInt(getComputedStyle(root).getPropertyValue('--btm')) || 175;
    handle.classList.add('dragging');
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    // drag up → bigger bottom panel (startY - e.clientY adds height)
    const h = Math.min(MAX, Math.max(MIN, startH + (startY - e.clientY)));
    root.style.setProperty('--btm', h + 'px');
  });

  document.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });
})();

init();
