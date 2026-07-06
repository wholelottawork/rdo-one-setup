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
import type { Signer } from './hyperliquid';
export type { Signer } from './hyperliquid';

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

async function getTestnetAssetIndexMap(): Promise<Record<string, number>> {
  const meta = await hlTestnetInfo<[{ universe: Array<{ name: string }> }, unknown]>({
    type: 'metaAndAssetCtxs',
  });
  const universe = meta[0]?.universe ?? [];
  const assetIndexMap: Record<string, number> = {};
  universe.forEach((asset, i) => { assetIndexMap[asset.name] = i; });
  return assetIndexMap;
}

async function placeOrderTestnet(params: OrderParams): Promise<unknown> {
  const price = await getTestnetMarketPrice(params.symbol);
  if (!price) throw new Error('Cannot fetch testnet price for ' + params.symbol);

  const sz = parseFloat((params.sizeDollars / price).toFixed(8));
  const slip = 0.003;
  const limitPx = params.isLong ? price * (1 + slip) : price * (1 - slip);

  const assetIndexMap = await getTestnetAssetIndexMap();

  const { BUILDER_ADDRESS, BUILDER_FEE, floatToWire, signAction } = await import('./hyperliquid');

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
    builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE },
  };

  const nonce = Date.now();
  const signature = await signAction(params.signer, wireAction, nonce);
  const res = await fetch(`${HL_TESTNET_API}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Testnet exchange error ${res.status}: ${text}`);
  }
  return res.json();
}

async function closePositionTestnet(params: CloseParams): Promise<unknown> {
  const price = await getTestnetMarketPrice(params.symbol);
  if (!price) throw new Error('Cannot fetch testnet price for ' + params.symbol);
  const slip = 0.003;

  const assetIndexMap = await getTestnetAssetIndexMap();

  const { BUILDER_ADDRESS, BUILDER_FEE, floatToWire, signAction } = await import('./hyperliquid');

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
    builder: { b: BUILDER_ADDRESS, f: BUILDER_FEE },
  };

  const nonce = Date.now();
  const signature = await signAction(params.signer, wireAction, nonce);
  const res = await fetch(`${HL_TESTNET_API}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Testnet exchange error ${res.status}: ${text}`);
  }
  return res.json();
}

async function cancelOrderTestnet(params: CancelParams): Promise<unknown> {
  const assetIndexMap = await getTestnetAssetIndexMap();

  const { signAction } = await import('./hyperliquid');

  const wireAction = {
    type: 'cancel',
    cancels: [{ a: assetIndexMap[params.symbol] ?? 0, o: params.oid }],
  };
  const nonce = Date.now();
  const signature = await signAction(params.signer, wireAction, nonce);
  const res = await fetch(`${HL_TESTNET_API}/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: wireAction, nonce, signature }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Testnet exchange error ${res.status}: ${text}`);
  }
  return res.json();
}
