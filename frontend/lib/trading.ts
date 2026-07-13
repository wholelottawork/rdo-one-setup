import { cachedFetch } from './query';

const HL_API          = '/api/hl';
// Routed through the backend relay (backend/src/ws/relay.ts) rather than
// wss://api.hyperliquid.xyz/ws directly: browsers always send an Origin
// header, and Hyperliquid's gateway drops browser-origin connections that
// fan out ~20 subscriptions (close 1006 within ~3s → endless reconnect
// flapping). The relay's upstream connection is server-side (no Origin)
// and stable. Override in prod with NEXT_PUBLIC_HL_WS_URL.
const HL_WS_URL       = process.env.NEXT_PUBLIC_HL_WS_URL ?? 'ws://localhost:3001/ws';
// Builder fee attribution is intentionally NOT attached to orders: it needs
// a separate user-signed `approveBuilderFee` action first, and the perp fee
// cap is f<=100 (0.1%). Attaching it wrong silently rejects every order
// with "L1 error", so orders stay builder-less until a real builder
// address + approval flow exists.

let assetIndexMap: Record<string, number> = {};
let assetSzDecimals: Record<string, number> = {};
let assetMaxLeverage: Record<string, number> = {};

export async function getMetaAndAssetCtxs() {
  try {
    // Cache the network response (it changes slowly); re-derive the maps every
    // call so assetIndexMap stays populated even on cache hits.
    const data = await cachedFetch(['hl', 'metaAndAssetCtxs'], async () => {
      const res = await fetch(`${HL_API}/info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      });
      return res.json();
    }, 60_000);
    const universe = data[0]?.universe ?? [];
    const ctxs     = data[1] ?? [];
    universe.forEach((asset: any, i: number) => {
      assetIndexMap[asset.name] = i;
      assetSzDecimals[asset.name] = asset.szDecimals ?? 5;
      assetMaxLeverage[asset.name] = asset.maxLeverage ?? 50;
    });
    const map = new Map();
    universe.forEach((asset: any, i: number) => {
      const ctx = ctxs[i] ?? {};
      map.set(asset.name, {
        oraclePx:     parseFloat(ctx.oraclePx    ?? 0),
        prevDayPx:    parseFloat(ctx.prevDayPx   ?? 0),
        dayNtlVlm:    parseFloat(ctx.dayNtlVlm   ?? 0),
        openInterest: parseFloat(ctx.openInterest ?? 0),
        funding:      parseFloat(ctx.funding      ?? 0),
        markPx:       parseFloat(ctx.markPx       ?? 0),
        maxLeverage:  asset.maxLeverage ?? 50,
      });
    });
    return map;
  } catch { return null; }
}

export async function loadBalance(evmAddress: string) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: evmAddress }),
    });
    const data = await res.json();
    return parseFloat(data.marginSummary?.accountValue ?? 0);
  } catch { return 0; }
}

const HL_SPOT_STABLES = new Set(['USDC', 'USDT', 'USDT0', 'USDE', 'USDH', 'USD']);

export interface HLAccountState {
  perpEquity: number;        // marginSummary.accountValue (perp portion)
  spotTotal: number;         // total stable spot balances
  availableToTrade: number;  // spot (total-hold) + free cross margin — matches the exchange
  ntl: number;               // total notional of open positions
  marginUsed: number;
  upnl: number;              // summed from each position's unrealizedPnl
  positions: ReturnType<typeof mapPositions>;
}

function mapPositions(assetPositions: any[]) {
  return (assetPositions ?? [])
    .filter((p: any) => parseFloat(p.position.szi) !== 0)
    .map((p: any) => ({
      symbol:     p.position.coin,
      size:       parseFloat(p.position.szi),
      entryPrice: parseFloat(p.position.entryPx),
      leverage:   p.position.leverage?.value ?? 1,
      pnl:        parseFloat(p.position.unrealizedPnl),
      liqPrice:   parseFloat(p.position.liquidationPx ?? 0),
      margin:     parseFloat(p.position.marginUsed ?? 0),
      funding:    p.position.cumFunding?.sinceOpen != null
        ? parseFloat(p.position.cumFunding.sinceOpen)
        : null,
      isLong:     parseFloat(p.position.szi) > 0,
    }));
}

// Full account snapshot in one shot. "Available to Trade" is NOT perp equity:
// on unified accounts the spendable balance is spot stablecoins minus what's
// held as margin (total-hold), plus any free cross-margin — this matches the
// number the Hyperliquid exchange shows. accountValue alone is just the perp
// portion (and reads as only the isolated position's margin here).
export async function loadAccountState(evmAddress: string): Promise<HLAccountState> {
  const empty: HLAccountState = { perpEquity: 0, spotTotal: 0, availableToTrade: 0, ntl: 0, marginUsed: 0, upnl: 0, positions: [] };
  try {
    const post = (body: any) => fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).then(r => r.json());
    const [ch, spot] = await Promise.all([
      post({ type: 'clearinghouseState', user: evmAddress }),
      post({ type: 'spotClearinghouseState', user: evmAddress }),
    ]);
    const ms    = ch.marginSummary ?? {};
    const cross = ch.crossMarginSummary ?? {};
    const stables  = (spot.balances ?? []).filter((b: any) => HL_SPOT_STABLES.has(b.coin));
    const spotTotal = stables.reduce((s: number, b: any) => s + parseFloat(b.total ?? 0), 0);
    const spotAvail = stables.reduce((s: number, b: any) => s + (parseFloat(b.total ?? 0) - parseFloat(b.hold ?? 0)), 0);
    const crossFree = Math.max(0, parseFloat(cross.accountValue ?? 0) - parseFloat(cross.totalMarginUsed ?? 0));
    const positions = mapPositions(ch.assetPositions);
    return {
      perpEquity:       parseFloat(ms.accountValue ?? 0),
      spotTotal,
      availableToTrade: spotAvail + crossFree,
      ntl:              parseFloat(ms.totalNtlPos ?? 0),
      marginUsed:       parseFloat(ms.totalMarginUsed ?? 0),
      upnl:             positions.reduce((s, p) => s + p.pnl, 0),
      positions,
    };
  } catch { return empty; }
}

export async function getPositions(evmAddress: string) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: evmAddress }),
    });
    const data = await res.json();
    return (data.assetPositions ?? [])
      .filter((p: any) => parseFloat(p.position.szi) !== 0)
      .map((p: any) => ({
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

export async function getUserFills(evmAddress: string) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'userFills', user: evmAddress }),
    });
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map((f: any) => ({
      coin: f.coin, side: f.side === 'B' ? 'Buy' : 'Sell',
      price: parseFloat(f.px), size: parseFloat(f.sz),
      fee: parseFloat(f.fee ?? 0), pnl: parseFloat(f.closedPnl ?? 0),
      dir: f.dir ?? '', time: f.time, hash: f.hash, oid: f.oid,
    }));
  } catch { return []; }
}

export async function getOpenOrders(evmAddress: string) {
  try {
    // frontendOpenOrders, NOT openOrders: the plain endpoint omits
    // orderType/triggerPx for trigger orders, so resting TP/SL would map
    // to kind=null and the Positions table would keep showing "+ Add".
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'frontendOpenOrders', user: evmAddress }),
    });
    const data = await res.json();
    return (Array.isArray(data) ? data : []).map((o: any) => {
      const orderType = String(o.orderType ?? '');
      // Trigger orders show up as e.g. "Take Profit Market" / "Stop Market";
      // kind drives the TP/SL edit affordance in the open-orders tab.
      const kind = orderType.includes('Take Profit') ? 'tp'
        : orderType.includes('Stop') ? 'sl' : null;
      return {
        coin: o.coin, side: o.side === 'B' ? 'Buy' : 'Sell',
        price: parseFloat(o.limitPx), size: parseFloat(o.sz),
        origSize: parseFloat(o.origSz), oid: o.oid, time: o.timestamp,
        orderType, kind,
        triggerPx: o.triggerPx != null ? parseFloat(o.triggerPx) : null,
        reduceOnly: !!o.reduceOnly,
      };
    });
  } catch { return []; }
}

// Standalone reduce-only TP/SL triggers for an EXISTING position (no entry
// leg) — used by the Positions table's "+ Add" affordance. Grouping stays
// 'na': normalTpsl is only for triggers riding along with an entry order.
export async function placeTpslOrders({ symbol, size, isLong, signer, tpPx, slPx }: any) {
  const dec   = assetSzDecimals[symbol] ?? 5;
  const idx   = assetIndexMap[symbol] ?? 0;
  const sWire = szToWire(size, dec);
  const orders: any[] = [];
  for (const [tpx, kind] of [[tpPx, 'tp'], [slPx, 'sl']] as const) {
    if (tpx && tpx > 0) {
      orders.push({
        a: idx, b: !isLong, p: pxToWire(tpx, dec), s: sWire, r: true,
        t: { trigger: { isMarket: true, triggerPx: pxToWire(tpx, dec), tpsl: kind } },
      });
    }
  }
  if (!orders.length) throw new Error('No TP/SL price given');
  const wireAction = { type: 'order', orders, grouping: 'na' };
  const nonce = Date.now();
  const sig   = await signAction(signer, wireAction, nonce);
  const res   = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature: sig }),
  });
  return res.json();
}

// Edit a resting TP/SL trigger in place (HL `modify` action) — keeps the
// order's grouping/position binding, unlike cancel + re-place.
export async function modifyTriggerOrder({ oid, symbol, isBuy, size, triggerPx, kind, reduceOnly, signer }: any) {
  const dec = assetSzDecimals[symbol] ?? 5;
  const px  = pxToWire(triggerPx, dec);
  const wireAction = {
    type: 'modify',
    oid,
    order: {
      a: assetIndexMap[symbol] ?? 0,
      b: isBuy,
      p: px,
      s: szToWire(size, dec),
      r: reduceOnly,
      t: { trigger: { isMarket: true, triggerPx: px, tpsl: kind } },
    },
  };
  const nonce = Date.now();
  const sig   = await signAction(signer, wireAction, nonce);
  const res   = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature: sig }),
  });
  return res.json();
}

// Info type is `userFunding` (not userFundingHistory) and startTime is
// mandatory. Rows are { time, hash, delta: { type:"funding", coin, usdc,
// fundingRate, szi } } — the numbers live under `delta`.
export async function getFundingHistory(evmAddress: string, startTime = Date.now() - 14 * 86_400_000) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'userFunding', user: evmAddress, startTime }),
    });
    const data = await res.json();
    const rows  = Array.isArray(data) ? data : [];
    return rows
      .map((f: any) => {
        const d = f.delta ?? f;
        return {
          coin: d.coin, usdc: parseFloat(d.usdc),
          rate: parseFloat(d.fundingRate), size: parseFloat(d.szi), time: f.time,
        };
      })
      .sort((a: any, b: any) => b.time - a.time);
  } catch { return []; }
}

export async function getMarketPrice(symbol: string) {
  try {
    // allMids returns every symbol's mid in one payload, so cache the whole
    // map (5s) — concurrent per-symbol callers share one network round-trip.
    const mids = await cachedFetch(['hl', 'allMids'], async () => {
      const res = await fetch(`${HL_API}/info`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'allMids' }),
      });
      return res.json();
    }, 5_000);
    return parseFloat(mids[symbol] ?? 0);
  } catch { return 0; }
}

export async function getCandles(symbol: string, interval: number, count = 200) {
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
    return data.map((c: any) => ({ t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: +c.v }));
  } catch { return []; }
}

function ivStr(m: number) {
  if (m < 60)   return m + 'm';
  if (m < 1440) return (m / 60) + 'h';
  return '1d';
}

export async function getL2Book(symbol: string) {
  try {
    const res  = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'l2Book', coin: symbol }),
    });
    const data = await res.json();
    return {
      asks: (data.levels?.[1] ?? []).slice(0, 12).map((l: any) => ({ px: +l.px, sz: +l.sz })),
      bids: (data.levels?.[0] ?? []).slice(0, 12).map((l: any) => ({ px: +l.px, sz: +l.sz })),
    };
  } catch { return { asks: [], bids: [] }; }
}

function floatToWire(x: number) {
  const r = Math.round(x * 1e8) / 1e8;
  if (Number.isInteger(r)) return String(Math.round(r));
  return r.toFixed(8).replace(/\.?0+$/, '');
}

// HL price rules (exchange docs): ≤5 significant figures AND ≤(8 − szDecimals)
// decimal places, integers always allowed. A raw mid×(1±slippage) value like
// 118354.12345678 breaks the sig-fig rule → rejected "Order has invalid price."
function pxToWire(px: number, szDecimals: number) {
  const maxDecimals = Math.max(0, 8 - szDecimals);
  const sig = Number(px.toPrecision(5));
  return floatToWire(Number(sig.toFixed(maxDecimals)));
}

// Sizes must be rounded to the asset's szDecimals (same docs) —
// e.g. 0.001733 BTC (6 decimals, BTC has 5) → "Order has invalid size."
function szToWire(sz: number, szDecimals: number) {
  return floatToWire(Number(sz.toFixed(szDecimals)));
}

function mpEncode(val: any): Uint8Array {
  const out: number[] = [];
  function enc(v: any) {
    if (v === null || v === undefined) { out.push(0xc0); return; }
    if (typeof v === 'boolean') { out.push(v ? 0xc3 : 0xc2); return; }
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0) {
        if      (v <= 0x7f)   out.push(v);
        else if (v <= 0xff)   out.push(0xcc, v);
        else if (v <= 0xffff) out.push(0xcd, (v >> 8) & 0xff, v & 0xff);
        else if (v <= 0xffffffff) out.push(0xce, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
        else {
          // uint64 (0xcf) — order ids can exceed 32 bits; without this the
          // uint32 path silently truncates them and the action hash breaks.
          const ab = new ArrayBuffer(8);
          new DataView(ab).setBigUint64(0, BigInt(v), false);
          out.push(0xcf, ...new Uint8Array(ab));
        }
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
      v.forEach(enc); return;
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

async function computeActionHash(wireAction: any, nonce: number) {
  const { ethers } = await import('ethers');
  const packed = mpEncode(wireAction);
  const data   = new Uint8Array(packed.length + 9);
  data.set(packed);
  new DataView(data.buffer).setBigUint64(packed.length, BigInt(nonce), false);
  data[packed.length + 8] = 0x00;
  return ethers.keccak256(data);
}

async function signAction(signer: any, wireAction: any, nonce: number) {
  const { ethers } = await import('ethers');
  const hash   = await computeActionHash(wireAction, nonce);
  const domain = {
    // L1 actions (order/cancel) sign over the fixed "Exchange" domain with
    // chainId 1337 — NOT Arbitrum's 42161, which is only used for
    // user-signed actions (usdSend etc). Wrong chainId recovers the wrong
    // signer → "L1 error: User or API Wallet does not exist". Matches
    // hyperliquid-python-sdk signing.l1_payload.
    name: 'Exchange', version: '1', chainId: 1337,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] };
  const rawSig = await signer.signTypedData(domain, types, { source: 'a', connectionId: hash });
  return { r: rawSig.slice(0, 66), s: '0x' + rawSig.slice(66, 130), v: parseInt(rawSig.slice(130, 132), 16) };
}

// HL nonces must be strictly increasing per user — Date.now() can repeat
// within the same millisecond when two actions go out back-to-back
// (updateLeverage, then the entry order).
let lastNonce = 0;
function nextNonce() {
  lastNonce = Math.max(Date.now(), lastNonce + 1);
  return lastNonce;
}

// Leverage on HL is a per-asset ACCOUNT setting, not an order field — an
// entry opens at whatever leverage the account used last, so the UI's
// leverage input was cosmetic until now. updateLeverage is its own signed
// action: skip it only when the open position already matches; when flat
// the standing setting isn't queryable, so always set it. Clamped to the
// asset's maxLeverage from meta.
async function applyLeverage(signer: any, symbol: string, leverage: number, idx: number) {
  const maxLev = assetMaxLeverage[symbol] ?? 50;
  const req = Math.min(Math.max(Math.round(leverage) || 1, 1), maxLev);
  try {
    const addr = await signer.getAddress();
    const res = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: addr }),
    });
    const st = await res.json();
    const pos = st.assetPositions?.find((p: any) => p.position.coin === symbol);
    if (pos && Number(pos.position.leverage?.value) === req) return req;
  } catch { /* no position / query failed — set it below */ }
  const wireAction = { type: 'updateLeverage', asset: idx, isCross: true, leverage: req };
  const nonce = nextNonce();
  const sig = await signAction(signer, wireAction, nonce);
  const res = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature: sig }),
  });
  const d = await res.json();
  if (d.status !== 'ok')
    throw new Error(`Leverage update failed: ${d.response ?? d.error ?? 'unknown error'}`);
  return req;
}

export async function openPosition({ symbol, sizeDollars, leverage, isLong, signer, reduceOnly = false, tpPx, slPx }: any) {
  const price = await getMarketPrice(symbol);
  if (!price) throw new Error('Cannot fetch price for ' + symbol);
  const idx     = assetIndexMap[symbol] ?? 0;
  // Apply (and clamp) leverage BEFORE the entry — throws on rejection so an
  // order never silently opens at the wrong leverage.
  const appliedLeverage = leverage ? await applyLeverage(signer, symbol, leverage, idx) : 0;
  const sz      = parseFloat((sizeDollars / price).toFixed(8));
  const slip    = 0.003;
  const limitPx = isLong ? price * (1 + slip) : price * (1 - slip);
  const dec     = assetSzDecimals[symbol] ?? 5;
  const sWire   = szToWire(sz, dec);
  const orders: any[] = [
    { a: idx, b: isLong, p: pxToWire(limitPx, dec), s: sWire, r: reduceOnly, t: { limit: { tif: 'Ioc' } } },
  ];
  // TP/SL ride the SAME action as reduce-only market triggers on the opposite
  // side, grouped with the entry (grouping normalTpsl) — one wallet signature,
  // and the triggers are bound to the position this entry opens. p mirrors the
  // trigger price (python-SDK style; ignored for isMarket triggers).
  for (const [tpx, kind] of [[tpPx, 'tp'], [slPx, 'sl']] as const) {
    if (tpx && tpx > 0) {
      orders.push({
        a: idx, b: !isLong, p: pxToWire(tpx, dec), s: sWire, r: true,
        t: { trigger: { isMarket: true, triggerPx: pxToWire(tpx, dec), tpsl: kind } },
      });
    }
  }
  const wireAction = {
    type: 'order',
    orders,
    grouping: orders.length > 1 ? 'normalTpsl' : 'na',
  };
  const nonce = nextNonce();
  const sig   = await signAction(signer, wireAction, nonce);
  const res   = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature: sig }),
  });
  const out = await res.json();
  out.appliedLeverage = appliedLeverage;
  return out;
}

export async function closePosition({ symbol, size, isLong, signer }: any) {
  const price = await getMarketPrice(symbol);
  if (!price) throw new Error('Cannot fetch price for ' + symbol);
  const slip = 0.003;
  const wireAction = {
    type: 'order',
    orders: [{ a: assetIndexMap[symbol] ?? 0, b: !isLong, p: pxToWire(!isLong ? price * (1 + slip) : price * (1 - slip), assetSzDecimals[symbol] ?? 5), s: szToWire(Math.abs(size), assetSzDecimals[symbol] ?? 5), r: true, t: { limit: { tif: 'Ioc' } } }],
    grouping: 'na',
  };
  const nonce = Date.now();
  const sig   = await signAction(signer, wireAction, nonce);
  const res   = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature: sig }),
  });
  return res.json();
}

export async function cancelOrder({ oid, symbol, signer }: any) {
  const wireAction = { type: 'cancel', cancels: [{ a: assetIndexMap[symbol] ?? 0, o: oid }] };
  const nonce = Date.now();
  const sig   = await signAction(signer, wireAction, nonce);
  const res   = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature: sig }),
  });
  return res.json();
}

export function startPriceStream(
  symbols: string[],
  onPrice: (sym: string, px: number) => void,
  onBook: any,
  onTrade: (sym: string, trade: any) => void
) {
  let ws: WebSocket, alive = true;

  function connect() {
    ws = new WebSocket(HL_WS_URL);
    ws.onopen = () => {
      const dotEl = document.getElementById('wsDot');
      const stEl  = document.getElementById('wsStatus');
      if (dotEl) dotEl.className      = 'ws-dot live';
      if (stEl)  stEl.textContent = 'LIVE';
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
      symbols.forEach(sym =>
        ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'trades', coin: sym } }))
      );
    };
    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.channel === 'allMids') {
          symbols.forEach(sym => {
            const px = parseFloat(msg.data.mids[sym]);
            if (!isNaN(px) && px > 0) onPrice(sym, px);
          });
        }
        if (msg.channel === 'trades' && Array.isArray(msg.data)) {
          msg.data.forEach((tr: any) => {
            onTrade(tr.coin, { side: tr.side === 'B' ? 'buy' : 'sell', px: +tr.px, sz: +tr.sz, time: tr.time });
          });
        }
      } catch {}
    };
    ws.onclose = () => {
      const dotEl = document.getElementById('wsDot');
      const stEl  = document.getElementById('wsStatus');
      if (dotEl) dotEl.className = 'ws-dot err';
      if (stEl)  stEl.textContent = 'RECONNECTING...';
      if (alive) setTimeout(connect, 3000);
    };
  }

  connect();
  return () => { alive = false; ws?.close(); };
}

export function startBookStream(symbol: string, onBook: (sym: string, book: any) => void) {
  let ws: WebSocket, alive = true;

  function connect() {
    ws = new WebSocket(HL_WS_URL);
    ws.onopen = () => {
      ws.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'l2Book', coin: symbol } }));
    };
    ws.onmessage = ({ data }) => {
      try {
        const msg = JSON.parse(data);
        if (msg.channel === 'l2Book' && msg.data) {
          const d = msg.data;
          onBook(d.coin, {
            asks: (d.levels?.[1] ?? []).slice(0, 12).map((l: any) => ({ px: +l.px, sz: +l.sz })),
            bids: (d.levels?.[0] ?? []).slice(0, 12).map((l: any) => ({ px: +l.px, sz: +l.sz })),
          });
        }
      } catch {}
    };
    ws.onclose = () => { if (alive) setTimeout(connect, 3000); };
  }

  connect();
  return () => { alive = false; ws?.close(); };
}
