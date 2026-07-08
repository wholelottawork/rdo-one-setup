// Hyperliquid REST + signing — ported from src/trading.js. All calls go
// through the Fastify backend proxy at /api/hl/* (Redis-cached info reads,
// pass-through /exchange). Orders stay client-signed with the user's wallet;
// the backend never holds keys.

const HL_API = '/api/hl';
const HL_TESTNET_API = '/api/hl-testnet';
export const BUILDER_ADDRESS = '0x0000000000000000000000000000000000000000'; // ← replace with your treasury wallet
export const BUILDER_FEE = 1000; // tenths of bps → 0.10%

/** Every HL call below takes this as a trailing param, default 'mainnet' — no
 * existing call site needs to change to keep current (mainnet) behavior. */
export type HLNetwork = 'mainnet' | 'testnet';

function hlApiBase(network: HLNetwork): string {
  return network === 'testnet' ? HL_TESTNET_API : HL_API;
}

const assetIndexMap: Record<string, number> = {};

export interface AssetCtx {
  oraclePx: number;
  prevDayPx: number;
  dayNtlVlm: number;
  openInterest: number;
  funding: number;
}

export interface Position {
  symbol: string;
  size: number;
  entryPrice: number;
  leverage: number;
  pnl: number;
  liqPrice: number;
  isLong: boolean;
}

export interface Fill {
  coin: string;
  side: 'Buy' | 'Sell';
  price: number;
  size: number;
  fee: number;
  pnl: number;
  dir: string;
  time: number;
  hash: string;
  oid: number;
}

export interface OpenOrder {
  coin: string;
  side: 'Buy' | 'Sell';
  price: number;
  size: number;
  origSize: number;
  oid: number;
  time: number;
}

export interface FundingEntry {
  coin: string;
  usdc: number;
  rate: number;
  size: number;
  time: number;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface OrderBookLevel {
  px: number;
  sz: number;
}

export interface OrderBook {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
}

async function hlInfo<T>(body: Record<string, unknown>, network: HLNetwork = 'mainnet'): Promise<T> {
  const res = await fetch(`${hlApiBase(network)}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function getMetaAndAssetCtxs(network: HLNetwork = 'mainnet'): Promise<Map<string, AssetCtx> | null> {
  try {
    const data = await hlInfo<[{ universe: Array<{ name: string }> }, Array<Record<string, unknown>>]>({
      type: 'metaAndAssetCtxs',
    }, network);
    const universe = data[0]?.universe ?? [];
    const ctxs = data[1] ?? [];

    universe.forEach((asset, i) => { assetIndexMap[asset.name] = i; });

    const map = new Map<string, AssetCtx>();
    universe.forEach((asset, i) => {
      const ctx = ctxs[i] ?? {};
      map.set(asset.name, {
        oraclePx: parseFloat(String(ctx.oraclePx ?? 0)),
        prevDayPx: parseFloat(String(ctx.prevDayPx ?? 0)),
        dayNtlVlm: parseFloat(String(ctx.dayNtlVlm ?? 0)),
        openInterest: parseFloat(String(ctx.openInterest ?? 0)),
        funding: parseFloat(String(ctx.funding ?? 0)),
      });
    });
    return map;
  } catch {
    return null;
  }
}

export async function loadBalance(evmAddress: string, network: HLNetwork = 'mainnet'): Promise<number> {
  try {
    const data = await hlInfo<{ marginSummary?: { accountValue?: string } }>({
      type: 'clearinghouseState',
      user: evmAddress,
    }, network);
    return parseFloat(data.marginSummary?.accountValue ?? '0');
  } catch {
    return 0;
  }
}

interface ClearinghouseState {
  assetPositions?: Array<{
    position: {
      coin: string;
      szi: string;
      entryPx: string;
      leverage?: { value: number };
      unrealizedPnl: string;
      liquidationPx?: string;
    };
  }>;
}

export async function getPositions(evmAddress: string, network: HLNetwork = 'mainnet'): Promise<Position[]> {
  try {
    const data = await hlInfo<ClearinghouseState>({ type: 'clearinghouseState', user: evmAddress }, network);
    return (data.assetPositions ?? [])
      .filter(p => parseFloat(p.position.szi) !== 0)
      .map(p => ({
        symbol: p.position.coin,
        size: parseFloat(p.position.szi),
        entryPrice: parseFloat(p.position.entryPx),
        leverage: p.position.leverage?.value ?? 1,
        pnl: parseFloat(p.position.unrealizedPnl),
        liqPrice: parseFloat(p.position.liquidationPx ?? '0'),
        isLong: parseFloat(p.position.szi) > 0,
      }));
  } catch {
    return [];
  }
}

export async function getUserFills(evmAddress: string, network: HLNetwork = 'mainnet'): Promise<Fill[]> {
  try {
    const data = await hlInfo<Array<Record<string, unknown>>>({ type: 'userFills', user: evmAddress }, network);
    return (Array.isArray(data) ? data : []).map(f => ({
      coin: String(f.coin),
      side: f.side === 'B' ? 'Buy' : 'Sell',
      price: parseFloat(String(f.px)),
      size: parseFloat(String(f.sz)),
      fee: parseFloat(String(f.fee ?? 0)),
      pnl: parseFloat(String(f.closedPnl ?? 0)),
      dir: String(f.dir ?? ''),
      time: Number(f.time),
      hash: String(f.hash),
      oid: Number(f.oid),
    }));
  } catch {
    return [];
  }
}

export async function getOpenOrders(evmAddress: string, network: HLNetwork = 'mainnet'): Promise<OpenOrder[]> {
  try {
    const data = await hlInfo<Array<Record<string, unknown>>>({ type: 'openOrders', user: evmAddress }, network);
    return (Array.isArray(data) ? data : []).map(o => ({
      coin: String(o.coin),
      side: o.side === 'B' ? 'Buy' : 'Sell',
      price: parseFloat(String(o.limitPx)),
      size: parseFloat(String(o.sz)),
      origSize: parseFloat(String(o.origSz)),
      oid: Number(o.oid),
      time: Number(o.timestamp),
    }));
  } catch {
    return [];
  }
}

export async function getFundingHistory(evmAddress: string, network: HLNetwork = 'mainnet'): Promise<FundingEntry[]> {
  try {
    const data = await hlInfo<Array<Record<string, unknown>> | { fundingHistory?: Array<Record<string, unknown>> }>({
      type: 'userFundingHistory',
      user: evmAddress,
    }, network);
    const rows = Array.isArray(data) ? data : (data.fundingHistory ?? []);
    return rows.map(f => ({
      coin: String(f.coin),
      usdc: parseFloat(String(f.usdc)),
      rate: parseFloat(String(f.fundingRate)),
      size: parseFloat(String(f.szi)),
      time: Number(f.time),
    }));
  } catch {
    return [];
  }
}

export async function getMarketPrice(symbol: string, network: HLNetwork = 'mainnet'): Promise<number> {
  try {
    const mids = await hlInfo<Record<string, string>>({ type: 'allMids' }, network);
    return parseFloat(mids[symbol] ?? '0');
  } catch {
    return 0;
  }
}

function ivStr(m: number): string {
  if (m < 60) return m + 'm';
  if (m < 1440) return m / 60 + 'h';
  return '1d';
}

export async function getCandles(symbol: string, interval: number, count = 200, network: HLNetwork = 'mainnet'): Promise<Candle[]> {
  try {
    const ms = interval * 60 * 1000;
    const start = Date.now() - ms * count;
    const data = await hlInfo<Array<Record<string, unknown>>>({
      type: 'candleSnapshot',
      req: { coin: symbol, interval: ivStr(interval), startTime: start, endTime: Date.now() },
    }, network);
    if (!Array.isArray(data)) return [];
    return data.map(c => ({
      t: Number(c.t), o: +String(c.o), h: +String(c.h), l: +String(c.l), c: +String(c.c), v: +String(c.v),
    }));
  } catch {
    return [];
  }
}

export async function getL2Book(symbol: string, network: HLNetwork = 'mainnet'): Promise<OrderBook> {
  try {
    const data = await hlInfo<{ levels?: [Array<{ px: string; sz: string }>, Array<{ px: string; sz: string }>] }>({
      type: 'l2Book',
      coin: symbol,
    }, network);
    return {
      asks: (data.levels?.[1] ?? []).slice(0, 12).map(l => ({ px: +l.px, sz: +l.sz })),
      bids: (data.levels?.[0] ?? []).slice(0, 12).map(l => ({ px: +l.px, sz: +l.sz })),
    };
  } catch {
    return { asks: [], bids: [] };
  }
}

// ── Minimal msgpack encoder (for Hyperliquid action hashing) ───────────────
type MpValue = null | undefined | boolean | number | string | MpValue[] | { [key: string]: MpValue };

export function mpEncode(val: MpValue): Uint8Array {
  const out: number[] = [];
  function enc(v: MpValue) {
    if (v === null || v === undefined) { out.push(0xc0); return; }
    if (typeof v === 'boolean') { out.push(v ? 0xc3 : 0xc2); return; }
    if (typeof v === 'number') {
      if (Number.isInteger(v) && v >= 0) {
        if (v <= 0x7f) out.push(v);
        else if (v <= 0xff) out.push(0xcc, v);
        else if (v <= 0xffff) out.push(0xcd, (v >> 8) & 0xff, v & 0xff);
        else out.push(0xce, (v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
      } else if (Number.isInteger(v) && v < 0) {
        if (v >= -32) out.push(v & 0xff);
        else out.push(0xd0, v & 0xff);
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
      if (n <= 31) out.push(0xa0 | n);
      else if (n <= 0xff) out.push(0xd9, n);
      else out.push(0xda, (n >> 8) & 0xff, n & 0xff);
      for (const x of b) out.push(x);
      return;
    }
    if (Array.isArray(v)) {
      const n = v.length;
      if (n <= 15) out.push(0x90 | n);
      else if (n <= 0xffff) out.push(0xdc, (n >> 8) & 0xff, n & 0xff);
      v.forEach(enc);
      return;
    }
    if (typeof v === 'object') {
      const keys = Object.keys(v);
      const n = keys.length;
      if (n <= 15) out.push(0x80 | n);
      else if (n <= 0xffff) out.push(0xde, (n >> 8) & 0xff, n & 0xff);
      keys.forEach(k => { enc(k); enc(v[k]); });
    }
  }
  enc(val);
  return new Uint8Array(out);
}

export function floatToWire(x: number): string {
  const r = Math.round(x * 1e8) / 1e8;
  if (Number.isInteger(r)) return String(Math.round(r));
  return r.toFixed(8).replace(/\.?0+$/, '');
}

export async function computeActionHash(wireAction: MpValue, nonce: number): Promise<string> {
  const { ethers } = await import('ethers');
  const packed = mpEncode(wireAction);
  const data = new Uint8Array(packed.length + 9);
  data.set(packed);
  new DataView(data.buffer).setBigUint64(packed.length, BigInt(nonce), false);
  data[packed.length + 8] = 0x00; // no vault address
  return ethers.keccak256(data);
}

export interface Signer {
  // Method (not arrow-property) syntax so ethers' concretely-typed
  // JsonRpcSigner is assignable — TS checks method params bivariantly.
  signTypedData(domain: unknown, types: unknown, value: unknown): Promise<string>;
}

/**
 * EIP-712 domain/source for HL's "phantom agent" L1 action signing (orders,
 * cancels). Per Hyperliquid's own SDK (hyperliquid-python-sdk
 * utils/signing.py: l1_payload/construct_phantom_agent), the domain chainId
 * is ALWAYS 1337 for both networks — mainnet vs testnet is distinguished
 * purely by the `source` field ('a' vs 'b'), not by chainId. (This app
 * previously hardcoded chainId: 42161 with source always 'a', which is
 * wrong for testnet and — per the SDK — not the documented value for
 * mainnet either.)
 */
export async function signAction(signer: Signer, wireAction: MpValue, nonce: number, network: HLNetwork = 'mainnet') {
  const hash = await computeActionHash(wireAction, nonce);
  const domain = {
    name: 'Exchange', version: '1', chainId: 1337,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    Agent: [
      { name: 'source', type: 'string' },
      { name: 'connectionId', type: 'bytes32' },
    ],
  };
  const source = network === 'mainnet' ? 'a' : 'b';
  const rawSig = await signer.signTypedData(domain, types, { source, connectionId: hash });
  return {
    r: rawSig.slice(0, 66),
    s: '0x' + rawSig.slice(66, 130),
    v: parseInt(rawSig.slice(130, 132), 16),
  };
}

interface TradeParams {
  symbol: string;
  sizeDollars: number;
  leverage: number;
  isLong: boolean;
  signer: Signer;
  network?: HLNetwork;
}

export async function openPosition({ symbol, sizeDollars, isLong, signer, network = 'mainnet' }: TradeParams) {
  const price = await getMarketPrice(symbol, network);
  if (!price) throw new Error('Cannot fetch price for ' + symbol);

  const sz = parseFloat((sizeDollars / price).toFixed(8));
  const slip = 0.003;
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
  const signature = await signAction(signer, wireAction, nonce, network);
  const res = await fetch(`${hlApiBase(network)}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature }),
  });
  return res.json();
}

export async function closePosition(
  { symbol, size, isLong, signer, network = 'mainnet' }: { symbol: string; size: number; isLong: boolean; signer: Signer; network?: HLNetwork },
) {
  const price = await getMarketPrice(symbol, network);
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
  const signature = await signAction(signer, wireAction, nonce, network);
  const res = await fetch(`${hlApiBase(network)}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature }),
  });
  return res.json();
}

export async function cancelOrder({ oid, symbol, signer, network = 'mainnet' }: { oid: number; symbol: string; signer: Signer; network?: HLNetwork }) {
  const wireAction = {
    type: 'cancel',
    cancels: [{ a: assetIndexMap[symbol] ?? 0, o: oid }],
  };
  const nonce = Date.now();
  const signature = await signAction(signer, wireAction, nonce, network);
  const res = await fetch(`${hlApiBase(network)}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature }),
  });
  return res.json();
}

export interface HLTickerStat {
  price: number;
  prevDayPx: number;
  chgPct: number;
  vol: number;
  fund8h: number;
  oi: number;
  lev: number;
}

/** Powers the market dropdown table — ported from main.js's fetchAllMids(). */
export async function getHLTickers(network: HLNetwork = 'mainnet'): Promise<Record<string, HLTickerStat>> {
  try {
    const data = await hlInfo<[{ universe: Array<{ name: string; maxLeverage?: number }> }, Array<Record<string, unknown>>]>({
      type: 'metaAndAssetCtxs',
    }, network);
    const universe = data[0]?.universe ?? [];
    const ctxs = data[1] ?? [];
    const out: Record<string, HLTickerStat> = {};
    universe.forEach((asset, i) => {
      const ctx = ctxs[i] ?? {};
      const price = parseFloat(String(ctx.markPx ?? 0));
      const prev = parseFloat(String(ctx.prevDayPx ?? price));
      out[asset.name] = {
        price,
        prevDayPx: prev,
        chgPct: prev ? ((price - prev) / prev) * 100 : 0,
        vol: parseFloat(String(ctx.dayNtlVlm ?? 0)),
        fund8h: parseFloat(String(ctx.funding ?? 0)) * 100,
        oi: parseFloat(String(ctx.openInterest ?? 0)) * price,
        lev: asset.maxLeverage ?? 0,
      };
    });
    return out;
  } catch {
    return {};
  }
}

/**
 * Withdraw USDC from Hyperliquid to an Arbitrum address — a "user-signed
 * action" (different EIP-712 domain/type than the Agent-signed order flow
 * above). Ported from the withdraw flow in the original transfer.html.
 *
 * CAVEAT: this signing scheme has not been exercised against a funded
 * account in this migration — verify carefully (small amount first) before
 * relying on it, per Hyperliquid's "HyperliquidTransaction:Withdraw" spec.
 */
export async function hlWithdraw(
  { destination, amount, signer, network = 'mainnet' }: { destination: string; amount: number; signer: Signer; network?: HLNetwork },
) {
  const nonce = Date.now();
  // signatureChainId is fixed at 0x66eee (421614, Arbitrum Sepolia) for both
  // networks per HL's SDK — it's just the wallet-signing chain, unrelated to
  // which HL environment the action targets. hyperliquidChain is what
  // actually routes/scopes the action to mainnet vs testnet.
  const action = {
    type: 'withdraw3',
    hyperliquidChain: network === 'mainnet' ? 'Mainnet' : 'Testnet',
    signatureChainId: '0x66eee',
    destination,
    amount: floatToWire(amount),
    time: nonce,
  };

  const domain = {
    name: 'HyperliquidSignTransaction', version: '1', chainId: 421614,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    'HyperliquidTransaction:Withdraw': [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'destination', type: 'string' },
      { name: 'amount', type: 'string' },
      { name: 'time', type: 'uint64' },
    ],
  };
  const rawSig = await signer.signTypedData(domain, types, action);
  const signature = {
    r: rawSig.slice(0, 66),
    s: '0x' + rawSig.slice(66, 130),
    v: parseInt(rawSig.slice(130, 132), 16),
  };

  const res = await fetch(`${hlApiBase(network)}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature }),
  });
  return res.json();
}

// In prod: mainnet uses the backend WS relay; in dev, connect direct (no CORS
// on WS). Testnet always connects direct — it's low volume/test-only, same
// reasoning as the /hl-testnet REST proxy (server/routes/proxy.js), so no
// relay has been built for it.
export function hlWsUrl(network: HLNetwork = 'mainnet'): string {
  if (network === 'testnet') return 'wss://api.hyperliquid-testnet.xyz/ws';
  if (process.env.NODE_ENV === 'production' && typeof window !== 'undefined') {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws`;
  }
  return 'wss://api.hyperliquid.xyz/ws';
}
