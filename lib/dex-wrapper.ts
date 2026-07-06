export type TradeMode = 'hl' | 'aster';

export interface UnifiedMarket {
  symbol: string;
  price: number;
  priceChange24h: number;
  volume24h: number;
  fundingRate8h: number;
  openInterest: number;
  maxLeverage: number;
}

export interface Signer {
  signTypedData(domain: unknown, types: unknown, value: unknown): Promise<string>;
}

export interface OrderParams {
  symbol: string;
  sizeDollars: number;
  leverage: number;
  isLong: boolean;
  signer: Signer;
}

export interface CloseParams {
  symbol: string;
  size: number;
  isLong: boolean;
  signer: Signer;
}

export interface CancelParams {
  oid: number;
  symbol: string;
  signer: Signer;
}

import type { Candle, OrderBook, Position, Fill, OpenOrder } from './hyperliquid';
export type { Candle, OrderBook, Position, Fill, OpenOrder } from './hyperliquid';

function assertHLMode(mode: TradeMode): void {
  if (mode === 'aster') {
    throw new Error('Aster user info requires API key authentication — not yet supported.');
  }
}

export async function getMarkets(mode: TradeMode): Promise<UnifiedMarket[]> {
  try {
    if (mode === 'aster') {
      const { getAsterTickers } = await import('./aster');
      const tickers = await getAsterTickers();
      return tickers.map(t => ({
        symbol: t.symbol,
        price: t.lastPrice,
        priceChange24h: t.priceChangePercent,
        volume24h: t.quoteVolume,
        fundingRate8h: 0,
        openInterest: 0,
        maxLeverage: 200,
      }));
    }

    const { getHLTickers } = await import('./hyperliquid');
    const tickers = await getHLTickers();
    return Object.entries(tickers).map(([symbol, t]) => ({
      symbol,
      price: t.price,
      priceChange24h: t.chgPct,
      volume24h: t.vol,
      fundingRate8h: t.fund8h,
      openInterest: t.oi,
      maxLeverage: t.lev,
    }));
  } catch (e) {
    console.error('getMarkets failed', { mode }, e);
    return [];
  }
}

export async function getBook(mode: TradeMode, symbol: string): Promise<OrderBook> {
  try {
    if (mode === 'aster') {
      const { getAsterBook } = await import('./aster');
      return await getAsterBook(symbol);
    }
    const { getL2Book } = await import('./hyperliquid');
    return await getL2Book(symbol);
  } catch (e) {
    console.error('getBook failed', { mode, symbol }, e);
    return { asks: [], bids: [] };
  }
}

export async function getCandles(mode: TradeMode, symbol: string, intervalMinutes: number, count = 200): Promise<Candle[]> {
  try {
    if (mode === 'aster') {
      const { getAsterCandles } = await import('./aster');
      return await getAsterCandles(symbol, intervalMinutes, count);
    }
    const { getCandles: getHLCandles } = await import('./hyperliquid');
    return await getHLCandles(symbol, intervalMinutes, count);
  } catch (e) {
    console.error('getCandles failed', { mode, symbol, intervalMinutes, count }, e);
    return [];
  }
}

export async function getFundingRates(mode: TradeMode): Promise<Record<string, number>> {
  try {
    if (mode === 'aster') {
      const { getAsterFunding } = await import('./aster');
      return await getAsterFunding(); // already scaled by 100 (percentage)
    }
    const { getMetaAndAssetCtxs } = await import('./hyperliquid');
    const map = await getMetaAndAssetCtxs();
    if (!map) return {};
    const out: Record<string, number> = {};
    map.forEach((ctx, symbol) => {
      out[symbol] = ctx.funding * 100; // scale to percentage
    });
    return out; // both branches return funding rates as percentages (already scaled by 100)
  } catch (e) {
    console.error('getFundingRates failed', { mode }, e);
    return {};
  }
}

export async function getBalance(mode: TradeMode, evmAddress: string): Promise<number> {
  assertHLMode(mode);
  try {
    const { loadBalance } = await import('./hyperliquid');
    return await loadBalance(evmAddress);
  } catch (e) {
    console.error('getBalance failed', { mode, evmAddress }, e);
    return 0;
  }
}

export async function getPositions(mode: TradeMode, evmAddress: string): Promise<Position[]> {
  assertHLMode(mode);
  try {
    const { getPositions: getHLPositions } = await import('./hyperliquid');
    return await getHLPositions(evmAddress);
  } catch (e) {
    console.error('getPositions failed', { mode, evmAddress }, e);
    return [];
  }
}

export async function getFills(mode: TradeMode, evmAddress: string): Promise<Fill[]> {
  assertHLMode(mode);
  try {
    const { getUserFills } = await import('./hyperliquid');
    return await getUserFills(evmAddress);
  } catch (e) {
    console.error('getFills failed', { mode, evmAddress }, e);
    return [];
  }
}

export async function getOpenOrders(mode: TradeMode, evmAddress: string): Promise<OpenOrder[]> {
  assertHLMode(mode);
  try {
    const { getOpenOrders: getHLOpenOrders } = await import('./hyperliquid');
    return await getHLOpenOrders(evmAddress);
  } catch (e) {
    console.error('getOpenOrders failed', { mode, evmAddress }, e);
    return [];
  }
}

export interface TradingOptions {
  testnet?: boolean;
}

export async function placeOrder(
  mode: TradeMode,
  params: OrderParams,
  opts: TradingOptions = {}
): Promise<unknown> {
  if (mode === 'aster') {
    throw new Error('Aster perp trading is not supported.');
  }

  if (opts.testnet) {
    return placeOrderTestnet(params);
  }

  const { openPosition } = await import('./hyperliquid');
  return openPosition(params);
}

export async function closePosition(
  mode: TradeMode,
  params: CloseParams,
  opts: TradingOptions = {}
): Promise<unknown> {
  if (mode === 'aster') {
    throw new Error('Aster perp trading is not supported.');
  }

  if (opts.testnet) {
    return closePositionTestnet(params);
  }

  const { closePosition: hlClosePosition } = await import('./hyperliquid');
  return hlClosePosition(params);
}

export async function cancelOrder(
  mode: TradeMode,
  params: CancelParams,
  opts: TradingOptions = {}
): Promise<unknown> {
  if (mode === 'aster') {
    throw new Error('Aster perp trading is not supported.');
  }

  if (opts.testnet) {
    return cancelOrderTestnet(params);
  }

  const { cancelOrder: hlCancelOrder } = await import('./hyperliquid');
  return hlCancelOrder(params);
}

// ── Testnet helpers ────────────────────────────────────────────────────────

const HL_TESTNET_API = '/api/hl-testnet';

async function hlTestnetInfo<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${HL_TESTNET_API}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getTestnetMarketPrice(symbol: string): Promise<number> {
  try {
    const mids = await hlTestnetInfo<Record<string, string>>({ type: 'allMids' });
    return parseFloat(mids[symbol] ?? '0');
  } catch {
    return 0;
  }
}

async function placeOrderTestnet(params: OrderParams): Promise<unknown> {
  const price = await getTestnetMarketPrice(params.symbol);
  if (!price) throw new Error('Cannot fetch testnet price for ' + params.symbol);

  const sz = parseFloat((params.sizeDollars / price).toFixed(8));
  const slip = 0.003;
  const limitPx = params.isLong ? price * (1 + slip) : price * (1 - slip);

  const meta = await hlTestnetInfo<[{ universe: Array<{ name: string }> }, unknown]>({
    type: 'metaAndAssetCtxs',
  });
  const universe = meta[0]?.universe ?? [];
  const assetIndexMap: Record<string, number> = {};
  universe.forEach((asset, i) => { assetIndexMap[asset.name] = i; });

  const wireAction = {
    type: 'order',
    orders: [{
      a: assetIndexMap[params.symbol] ?? 0,
      b: params.isLong,
      p: floatToWire(limitPx),
      s: floatToWire(sz),
      r: false,
      t: { limit: { tif: 'Ioc' } },
    }],
    grouping: 'na',
    builder: { b: '0x0000000000000000000000000000000000000000', f: 1000 },
  };

  const nonce = Date.now();
  const signature = await signActionTestnet(params.signer, wireAction, nonce);
  const res = await fetch(`${HL_TESTNET_API}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature }),
  });
  return res.json();
}

async function closePositionTestnet(params: CloseParams): Promise<unknown> {
  const price = await getTestnetMarketPrice(params.symbol);
  if (!price) throw new Error('Cannot fetch testnet price for ' + params.symbol);
  const slip = 0.003;

  const meta = await hlTestnetInfo<[{ universe: Array<{ name: string }> }, unknown]>({
    type: 'metaAndAssetCtxs',
  });
  const universe = meta[0]?.universe ?? [];
  const assetIndexMap: Record<string, number> = {};
  universe.forEach((asset, i) => { assetIndexMap[asset.name] = i; });

  const wireAction = {
    type: 'order',
    orders: [{
      a: assetIndexMap[params.symbol] ?? 0,
      b: !params.isLong,
      p: floatToWire(!params.isLong ? price * (1 + slip) : price * (1 - slip)),
      s: floatToWire(Math.abs(params.size)),
      r: true,
      t: { limit: { tif: 'Ioc' } },
    }],
    grouping: 'na',
    builder: { b: '0x0000000000000000000000000000000000000000', f: 1000 },
  };

  const nonce = Date.now();
  const signature = await signActionTestnet(params.signer, wireAction, nonce);
  const res = await fetch(`${HL_TESTNET_API}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature }),
  });
  return res.json();
}

async function cancelOrderTestnet(params: CancelParams): Promise<unknown> {
  const meta = await hlTestnetInfo<[{ universe: Array<{ name: string }> }, unknown]>({
    type: 'metaAndAssetCtxs',
  });
  const universe = meta[0]?.universe ?? [];
  const assetIndexMap: Record<string, number> = {};
  universe.forEach((asset, i) => { assetIndexMap[asset.name] = i; });

  const wireAction = {
    type: 'cancel',
    cancels: [{ a: assetIndexMap[params.symbol] ?? 0, o: params.oid }],
  };
  const nonce = Date.now();
  const signature = await signActionTestnet(params.signer, wireAction, nonce);
  const res = await fetch(`${HL_TESTNET_API}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature }),
  });
  return res.json();
}

// ── Minimal msgpack encoder (copied from hyperliquid.ts for testnet signing) ──

type MpValue = null | undefined | boolean | number | string | MpValue[] | { [key: string]: MpValue };

function mpEncode(val: MpValue): Uint8Array {
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

function floatToWire(x: number): string {
  const r = Math.round(x * 1e8) / 1e8;
  if (Number.isInteger(r)) return String(Math.round(r));
  return r.toFixed(8).replace(/\.?0+$/, '');
}

async function computeActionHash(wireAction: MpValue, nonce: number): Promise<string> {
  const { ethers } = await import('ethers');
  const packed = mpEncode(wireAction);
  const data = new Uint8Array(packed.length + 9);
  data.set(packed);
  new DataView(data.buffer).setBigUint64(packed.length, BigInt(nonce), false);
  data[packed.length + 8] = 0x00;
  return ethers.keccak256(data);
}

async function signActionTestnet(signer: Signer, wireAction: MpValue, nonce: number) {
  const hash = await computeActionHash(wireAction, nonce);
  const domain = {
    name: 'Exchange', version: '1', chainId: 42161,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    Agent: [
      { name: 'source', type: 'string' },
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
