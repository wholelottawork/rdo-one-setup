const HL_API          = 'https://api.hyperliquid.xyz';
const BUILDER_ADDRESS = '0x0000000000000000000000000000000000000000'; // ← replace with your treasury wallet
const BUILDER_FEE     = 1000; // tenths of bps → 0.10%

// Asset index map: { 'BTC': 0, 'ETH': 1, ... } — populated by getMetaAndAssetCtxs
let assetIndexMap = {};

// ── Meta + asset contexts ──────────────────────────────────────
export async function getMetaAndAssetCtxs() {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
    });
    const data     = await res.json();
    const universe = data[0]?.universe ?? [];
    const ctxs     = data[1] ?? [];

    // Build asset index map for wire format signing
    universe.forEach((asset, i) => { assetIndexMap[asset.name] = i; });

    const map = new Map();
    universe.forEach((asset, i) => {
      const ctx = ctxs[i] ?? {};
      map.set(asset.name, {
        oraclePx:     parseFloat(ctx.oraclePx    ?? 0),
        prevDayPx:    parseFloat(ctx.prevDayPx   ?? 0),
        dayNtlVlm:    parseFloat(ctx.dayNtlVlm   ?? 0),
        openInterest: parseFloat(ctx.openInterest ?? 0),
        funding:      parseFloat(ctx.funding      ?? 0),
      });
    });
    return map;
  } catch { return null; }
}

// ── Balance ────────────────────────────────────────────────────
export async function loadBalance(evmAddress) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: evmAddress }),
    });
    const data = await res.json();
    return parseFloat(data.marginSummary?.accountValue ?? 0);
  } catch { return 0; }
}

// ── Positions ──────────────────────────────────────────────────
export async function getPositions(evmAddress) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: evmAddress }),
    });
    const data = await res.json();
    return (data.assetPositions ?? [])
      .filter(p => parseFloat(p.position.szi) !== 0)
      .map(p => ({
        symbol:     p.position.coin,
        size:       parseFloat(p.position.szi),
        entryPrice: parseFloat(p.position.entryPx),
        leverage:   p.position.leverage?.value ?? 1,
        pnl:        parseFloat(p.position.unrealizedPnl),
        liqPrice:   parseFloat(p.position.liquidationPx ?? 0),
        isLong:     parseFloat(p.position.szi) > 0,
      }));
  } catch { return []; }
}

// ── Trade history (user fills) ─────────────────────────────────
export async function getUserFills(evmAddress) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'userFills', user: evmAddress }),
    });
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map(f => ({
      coin:  f.coin,
      side:  f.side === 'B' ? 'Buy' : 'Sell',
      price: parseFloat(f.px),
      size:  parseFloat(f.sz),
      fee:   parseFloat(f.fee  ?? 0),
      pnl:   parseFloat(f.closedPnl ?? 0),
      dir:   f.dir ?? '',
      time:  f.time,
      hash:  f.hash,
      oid:   f.oid,
    }));
  } catch { return []; }
}

// ── Open orders ────────────────────────────────────────────────
export async function getOpenOrders(evmAddress) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'openOrders', user: evmAddress }),
    });
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map(o => ({
      coin:     o.coin,
      side:     o.side === 'B' ? 'Buy' : 'Sell',
      price:    parseFloat(o.limitPx),
      size:     parseFloat(o.sz),
      origSize: parseFloat(o.origSz),
      oid:      o.oid,
      time:     o.timestamp,
    }));
  } catch { return []; }
}

// ── Funding history ────────────────────────────────────────────
export async function getFundingHistory(evmAddress) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'userFundingHistory', user: evmAddress }),
    });
    const data = await res.json();
    const rows  = Array.isArray(data) ? data : (data.fundingHistory ?? []);
    return rows.map(f => ({
      coin: f.coin,
      usdc: parseFloat(f.usdc),
      rate: parseFloat(f.fundingRate),
      size: parseFloat(f.szi),
      time: f.time,
    }));
  } catch { return []; }
}

// ── Market price ───────────────────────────────────────────────
export async function getMarketPrice(symbol) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids' }),
    });
    const mids = await res.json();
    return parseFloat(mids[symbol] ?? 0);
  } catch { return 0; }
}

// ── Candles ────────────────────────────────────────────────────
export async function getCandles(symbol, interval, count = 200) {
  try {
    const ms    = interval * 60 * 1000;
    const start = Date.now() - ms * count;
    const res   = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'candleSnapshot',
        req: { coin: symbol, interval: ivStr(interval), startTime: start, endTime: Date.now() },
      }),
    });
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.map(c => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: +c.v }));
  } catch { return []; }
}

function ivStr(m) {
  if (m < 60)   return m + 'm';
  if (m < 1440) return (m / 60) + 'h';
  return '1d';
}

// ── Order book ─────────────────────────────────────────────────
export async function getL2Book(symbol) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'l2Book', coin: symbol }),
    });
    const data = await res.json();
    return {
      asks: (data.levels?.[1] ?? []).slice(0, 12).map(l => ({ px: +l.px, sz: +l.sz })),
      bids: (data.levels?.[0] ?? []).slice(0, 12).map(l => ({ px: +l.px, sz: +l.sz })),
    };
  } catch { return { asks: [], bids: [] }; }
}

// ── Minimal msgpack encoder (for Hyperliquid action hashing) ───
// Encodes: null, bool, uint, neg-int, float64, str, array, map
function mpEncode(val) {
  const out = [];
  function enc(v) {
    if (v === null || v === undefined) { out.push(0xc0); return; }
    if (typeof v === 'boolean') { out.push(v ? 0xc3 : 0xc2); return; }
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0) {
        if      (v <= 0x7f)       out.push(v);
        else if (v <= 0xff)       out.push(0xcc, v);
        else if (v <= 0xffff)     out.push(0xcd, (v >> 8) & 0xff, v & 0xff);
        else out.push(0xce, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
      } else if (Number.isInteger(v) && v < 0) {
        if (v >= -32) out.push(v & 0xff);
        else          out.push(0xd0, v & 0xff);
      } else {
        const ab = new ArrayBuffer(8);
        new DataView(ab).setFloat64(0, v, false);
        out.push(0xcb, ...new Uint8Array(ab));
      }
      return;
    }
    if (typeof v === 'string') {
      const b = new TextEncoder().encode(v);
      const n = b.length;
      if      (n <= 31)     out.push(0xa0 | n);
      else if (n <= 0xff)   out.push(0xd9, n);
      else                  out.push(0xda, (n >> 8) & 0xff, n & 0xff);
      for (const x of b) out.push(x);
      return;
    }
    if (Array.isArray(v)) {
      const n = v.length;
      if      (n <= 15)     out.push(0x90 | n);
      else if (n <= 0xffff) out.push(0xdc, (n >> 8) & 0xff, n & 0xff);
      v.forEach(enc);
      return;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      const n = keys.length;
      if      (n <= 15)     out.push(0x80 | n);
      else if (n <= 0xffff) out.push(0xde, (n >> 8) & 0xff, n & 0xff);
      keys.forEach(k => { enc(k); enc(v[k]); });
    }
  }
  enc(val);
  return new Uint8Array(out);
}

// ── Wire format helpers ────────────────────────────────────────
// Prices/sizes sent as strings per Hyperliquid wire protocol
function floatToWire(x) {
  const r = Math.round(x * 1e8) / 1e8;
  if (Number.isInteger(r)) return String(Math.round(r));
  return r.toFixed(8).replace(/\.?0+$/, '');
}

// Convert human-readable order to Hyperliquid wire format (short keys)
function orderToWire(order) {
  const wire = {
    a: assetIndexMap[order.coin] ?? 0, // asset index
    b: order.is_buy,
    p: floatToWire(order.limit_px),
    s: floatToWire(order.sz),
    r: order.reduce_only,
    t: order.order_type,
  };
  if (order.cloid != null) wire.c = order.cloid;
  return wire;
}

// ── Action hash (keccak256 of msgpack(action) + nonce + 0x00) ──
async function computeActionHash(wireAction, nonce) {
  const { ethers } = await import('ethers');
  const packed = mpEncode(wireAction);
  const data   = new Uint8Array(packed.length + 9);
  data.set(packed);
  new DataView(data.buffer).setBigUint64(packed.length, BigInt(nonce), false);
  data[packed.length + 8] = 0x00; // no vault address
  return ethers.keccak256(data);
}

// ── EIP-712 sign ───────────────────────────────────────────────
async function signAction(signer, wireAction, nonce) {
  const { ethers } = await import('ethers');
  const hash   = await computeActionHash(wireAction, nonce);
  const domain = {
    name: 'Exchange', version: '1', chainId: 42161,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    Agent: [
      { name: 'source',       type: 'string'  },
      { name: 'connectionId', type: 'bytes32' },
    ],
  };
  const rawSig = await signer.signTypedData(domain, types, { source: 'a', connectionId: hash });
  return {
    r: rawSig.slice(0, 66),
    s: '0x' + rawSig.slice(66, 130),
    v: parseInt(rawSig.slice(130, 132), 16),
  };
}

// ── Open position ──────────────────────────────────────────────
export async function openPosition({ symbol, sizeDollars, leverage, isLong, signer }) {
  const price = await getMarketPrice(symbol);
  if (!price) throw new Error('Cannot fetch price for ' + symbol);

  const sz      = parseFloat((sizeDollars / price).toFixed(8));
  const slip    = 0.003;
  const limitPx = isLong ? price * (1 + slip) : price * (1 - slip);

  const wireAction = {
    type: 'order',
    orders: [{
      a: assetIndexMap[symbol] ?? 0,
      b: isLong,
      p: floatToWire(limitPx),
      s: floatToWire(sz),
      r: false,
      t: { limit: { tif: 'Ioc' } },
    }],
    grouping: 'na',
    builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE },
  };

  const nonce = Date.now();
  const sig   = await signAction(signer, wireAction, nonce);
  const res   = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature: sig }),
  });
  return res.json();
}

// ── Close position ─────────────────────────────────────────────
export async function closePosition({ symbol, size, isLong, signer }) {
  const price = await getMarketPrice(symbol);
  if (!price) throw new Error('Cannot fetch price for ' + symbol);
  const slip = 0.003;

  const wireAction = {
    type: 'order',
    orders: [{
      a: assetIndexMap[symbol] ?? 0,
      b: !isLong,
      p: floatToWire(!isLong ? price * (1 + slip) : price * (1 - slip)),
      s: floatToWire(Math.abs(size)),
      r: true,
      t: { limit: { tif: 'Ioc' } },
    }],
    grouping: 'na',
    builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE },
  };

  const nonce = Date.now();
  const sig   = await signAction(signer, wireAction, nonce);
  const res   = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature: sig }),
  });
  return res.json();
}

// ── Cancel order ───────────────────────────────────────────────
export async function cancelOrder({ oid, symbol, signer }) {
  const wireAction = {
    type: 'cancel',
    cancels: [{ a: assetIndexMap[symbol] ?? 0, o: oid }],
  };
  const nonce = Date.now();
  const sig   = await signAction(signer, wireAction, nonce);
  const res   = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature: sig }),
  });
  return res.json();
}

// ── WebSocket stream ───────────────────────────────────────────
export function startPriceStream(symbols, onPrice, onBook, onTrade) {
  let ws, alive = true;

  function connect() {
    ws = new WebSocket('wss://api.hyperliquid.xyz/ws');

    ws.onopen = () => {
      document.getElementById('wsDot').className      = 'ws-dot live';
      document.getElementById('wsStatus').textContent = 'LIVE';

      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
      symbols.forEach(sym => {
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: sym } }));
      });
    };

    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.channel === 'allMids') {
          symbols.forEach(sym => {
            const px = parseFloat(msg.data.mids[sym]);
            if (px) onPrice(sym, px);
          });
        }
        if (msg.channel === 'l2Book' && onBook) {
          const { coin, levels } = msg.data;
          if (levels) onBook(coin, {
            bids: (levels[0] ?? []).slice(0, 12).map(l => ({ px: +l.px, sz: +l.sz })),
            asks: (levels[1] ?? []).slice(0, 12).map(l => ({ px: +l.px, sz: +l.sz })),
          });
        }
        if (msg.channel === 'trades' && onTrade) {
          (msg.data ?? []).forEach(t => onTrade(t.coin, {
            px: +t.px, sz: +t.sz,
            side: t.side === 'B' ? 'buy' : 'sell',
            time: t.time,
          }));
        }
      } catch { /* ignore */ }
    };

    ws.onclose = () => {
      document.getElementById('wsDot').className      = 'ws-dot err';
      document.getElementById('wsStatus').textContent = 'RECONNECTING...';
      if (alive) setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }

  connect();
  return { close: () => { alive = false; ws?.close(); } };
}

// ── Dedicated order-book stream for a single symbol ────────────
export function startBookStream(sym, onBook) {
  let ws, alive = true;
  function connect() {
    ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
    ws.onopen  = () => ws.send(JSON.stringify({
      method: 'subscribe', subscription: { type: 'l2Book', coin: sym },
    }));
    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.channel === 'l2Book') {
          const { coin, levels } = msg.data;
          if (coin === sym && levels) onBook(coin, {
            bids: (levels[0] ?? []).slice(0, 10).map(l => ({ px: +l.px, sz: +l.sz })),
            asks: (levels[1] ?? []).slice(0, 10).map(l => ({ px: +l.px, sz: +l.sz })),
          });
        }
      } catch {}
    };
    ws.onclose = () => { if (alive) setTimeout(connect, 2000); };
    ws.onerror = () => ws.close();
  }
  connect();
  return () => { alive = false; ws?.close(); };
}
