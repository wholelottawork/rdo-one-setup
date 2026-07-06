# Aster + Hyperliquid Unified Wrapper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mode-aware unified DEX wrapper (`lib/dex-wrapper.ts`) and React Query hooks (`lib/dex-wrapper-hooks.ts`) that consolidate Aster and Hyperliquid interactions behind a single `TradeMode` parameter, with testnet trading support.

**Architecture:** A thin delegation layer in `lib/dex-wrapper.ts` accepts `mode: 'hl' | 'aster'` and routes to existing `lib/hyperliquid.ts` or `lib/aster.ts` functions. No logic is duplicated. React Query hooks in `lib/dex-wrapper-hooks.ts` mirror the existing `hl-hooks.ts` / `aster-hooks.ts` pattern but accept `mode` as a parameter. Testnet trading is an opt-in flag on HL trading functions that swaps the API endpoint.

**Tech Stack:** TypeScript, React, `@tanstack/react-query`, existing `lib/hyperliquid.ts` and `lib/aster.ts`.

---

## File Map

| File | Responsibility | Action |
|------|---------------|--------|
| `lib/dex-wrapper.ts` | Unified API — all functions accept `TradeMode`, delegate to HL or Aster | **Create** |
| `lib/dex-wrapper-hooks.ts` | React Query hooks wrapping `dex-wrapper.ts` | **Create** |
| `lib/hyperliquid.ts` | HL REST API + signing (unchanged) | Read-only |
| `lib/aster.ts` | Aster REST API helpers (unchanged) | Read-only |
| `lib/hl-hooks.ts` | Existing HL React Query hooks (unchanged) | Read-only |
| `lib/aster-hooks.ts` | Existing Aster React Query hooks (unchanged) | Read-only |
| `server/routes/proxy.js` (or existing proxy file) | Add HL testnet proxy route | **Modify** (Phase 3) |
| `vite.config.js` | May need testnet proxy for dev | **Modify** (Phase 3) |

---

## Phase 1: Market Data Wrapper

### Task 1: Create `lib/dex-wrapper.ts` with types and `getMarkets`

**Files:**
- Create: `lib/dex-wrapper.ts`

- [ ] **Step 1: Write `lib/dex-wrapper.ts` with shared types and `getMarkets`**

```typescript
import type {
  getAsterTickers, getAsterBook, getAsterCandles, getAsterFunding,
} from './aster';
import type {
  getMetaAndAssetCtxs, getL2Book, getCandles, getHLTickers,
  type Candle, type OrderBook, type Position, type Fill, type OpenOrder,
} from './hyperliquid';

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

// Re-export types from hyperliquid.ts for convenience
export type { Candle, OrderBook, Position, Fill, OpenOrder };

export async function getMarkets(mode: TradeMode): Promise<UnifiedMarket[]> {
  if (mode === 'aster') {
    const { getAsterTickers } = await import('./aster');
    const tickers = await getAsterTickers();
    return tickers.map(t => ({
      symbol: t.symbol,
      price: t.lastPrice,
      priceChange24h: t.priceChangePercent,
      volume24h: t.quoteVolume,
      fundingRate8h: 0, // Aster premiumIndex is separate
      openInterest: 0,  // Aster OI is separate
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
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit lib/dex-wrapper.ts`
Expected: No errors (may warn about unused imports for now — that's fine, we'll use them in later tasks).

- [ ] **Step 3: Commit**

```bash
git add lib/dex-wrapper.ts
git commit -m "feat(dex-wrapper): add TradeMode type and getMarkets"
```

---

### Task 2: Add `getBook`, `getCandles`, `getFundingRates` to `lib/dex-wrapper.ts`

**Files:**
- Modify: `lib/dex-wrapper.ts` (append after `getMarkets`)

- [ ] **Step 1: Append the three market data functions**

```typescript
// Add these to lib/dex-wrapper.ts after getMarkets

export async function getBook(mode: TradeMode, symbol: string): Promise<OrderBook> {
  if (mode === 'aster') {
    const { getAsterBook } = await import('./aster');
    return getAsterBook(symbol);
  }
  const { getL2Book } = await import('./hyperliquid');
  return getL2Book(symbol);
}

export async function getCandles(
  mode: TradeMode,
  symbol: string,
  intervalMinutes: number
): Promise<Candle[]> {
  if (mode === 'aster') {
    const { getAsterCandles } = await import('./aster');
    return getAsterCandles(symbol, intervalMinutes, 200);
  }
  const { getCandles: getHLCandles } = await import('./hyperliquid');
  return getHLCandles(symbol, intervalMinutes, 200);
}

export async function getFundingRates(mode: TradeMode): Promise<Record<string, number>> {
  if (mode === 'aster') {
    const { getAsterFunding } = await import('./aster');
    return getAsterFunding();
  }
  const { getMetaAndAssetCtxs } = await import('./hyperliquid');
  const ctxs = await getMetaAndAssetCtxs();
  if (!ctxs) return {};
  const out: Record<string, number> = {};
  ctxs.forEach((ctx, symbol) => {
    out[symbol] = ctx.funding * 100;
  });
  return out;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit lib/dex-wrapper.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/dex-wrapper.ts
git commit -m "feat(dex-wrapper): add getBook, getCandles, getFundingRates"
```

---

### Task 3: Create `lib/dex-wrapper-hooks.ts` with market data hooks

**Files:**
- Create: `lib/dex-wrapper-hooks.ts`

- [ ] **Step 1: Write the hooks file**

```typescript
'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getMarkets, getBook, getCandles, getFundingRates,
  type TradeMode, type Candle, type OrderBook,
} from './dex-wrapper';

export function useMarkets(mode: TradeMode) {
  return useQuery({
    queryKey: ['dex', 'markets', mode],
    queryFn: () => getMarkets(mode),
    refetchInterval: 5_000,
  });
}

export function useBook(mode: TradeMode, symbol: string, enabled = true) {
  return useQuery({
    queryKey: ['dex', 'book', mode, symbol],
    queryFn: () => getBook(mode, symbol),
    refetchInterval: mode === 'aster' ? 2_000 : 3_000,
    enabled,
  });
}

export function useCandles(mode: TradeMode, symbol: string, intervalMinutes: number) {
  return useQuery<Candle[]>({
    queryKey: ['dex', 'candles', mode, symbol, intervalMinutes],
    queryFn: () => getCandles(mode, symbol, intervalMinutes),
  });
}

export function useFundingRates(mode: TradeMode) {
  return useQuery({
    queryKey: ['dex', 'funding', mode],
    queryFn: () => getFundingRates(mode),
    refetchInterval: 30_000,
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit lib/dex-wrapper-hooks.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/dex-wrapper-hooks.ts
git commit -m "feat(dex-wrapper-hooks): add market data hooks"
```

---

### Task 4: Manual verification of Phase 1

**Files:**
- Read-only: `app/(terminal)/page.tsx`

- [ ] **Step 1: Create a temporary test snippet in the terminal page to verify `getMarkets` for both modes**

Open `app/(terminal)/page.tsx` and add a temporary `useEffect` (will be removed after verification):

```tsx
// TEMPORARY: Phase 1 verification — remove after testing
import { getMarkets, getBook, getCandles, getFundingRates } from '@/lib/dex-wrapper';

useEffect(() => {
  async function test() {
    console.log('--- Testing HL markets ---');
    const hlMarkets = await getMarkets('hl');
    console.log('HL markets count:', hlMarkets.length);
    console.log('HL first market:', hlMarkets[0]);

    console.log('--- Testing Aster markets ---');
    const asterMarkets = await getMarkets('aster');
    console.log('Aster markets count:', asterMarkets.length);
    console.log('Aster first market:', asterMarkets[0]);

    console.log('--- Testing HL book (BTC) ---');
    const hlBook = await getBook('hl', 'BTC');
    console.log('HL book bids:', hlBook.bids.length, 'asks:', hlBook.asks.length);

    console.log('--- Testing Aster book (BTC) ---');
    const asterBook = await getBook('aster', 'BTC');
    console.log('Aster book bids:', asterBook.bids.length, 'asks:', asterBook.asks.length);

    console.log('--- Testing HL candles (BTC, 60m) ---');
    const hlCandles = await getCandles('hl', 'BTC', 60);
    console.log('HL candles count:', hlCandles.length);

    console.log('--- Testing Aster candles (BTC, 60m) ---');
    const asterCandles = await getCandles('aster', 'BTC', 60);
    console.log('Aster candles count:', asterCandles.length);

    console.log('--- Testing HL funding ---');
    const hlFunding = await getFundingRates('hl');
    console.log('HL funding keys:', Object.keys(hlFunding).slice(0, 5));

    console.log('--- Testing Aster funding ---');
    const asterFunding = await getFundingRates('aster');
    console.log('Aster funding keys:', Object.keys(asterFunding).slice(0, 5));
  }
  test();
}, []);
```

- [ ] **Step 2: Run the dev server and check browser console**

Run: `npm run dev` (or `bun dev` if using bun)
Open: `http://localhost:5173/terminal` (or the terminal page URL)
Check browser console for the test output.

Expected: All six tests log reasonable data. No `undefined` or `Error` in output.

- [ ] **Step 3: Remove the temporary test code**

Delete the temporary `useEffect` and import from `app/(terminal)/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add app/(terminal)/page.tsx  # if any changes remain, otherwise skip
git commit -m "chore: verify Phase 1 dex-wrapper market data"
```

---

## Phase 2: User Info Wrapper

### Task 5: Add user info functions to `lib/dex-wrapper.ts`

**Files:**
- Modify: `lib/dex-wrapper.ts` (append after market data functions)

- [ ] **Step 1: Append the four user info functions**

```typescript
// Add these to lib/dex-wrapper.ts after getFundingRates

export async function getBalance(mode: TradeMode, evmAddress: string): Promise<number> {
  if (mode === 'aster') {
    throw new Error('Aster user info requires API key authentication — not yet supported.');
  }
  const { loadBalance } = await import('./hyperliquid');
  return loadBalance(evmAddress);
}

export async function getPositions(mode: TradeMode, evmAddress: string): Promise<Position[]> {
  if (mode === 'aster') {
    throw new Error('Aster user info requires API key authentication — not yet supported.');
  }
  const { getPositions: getHLPositions } = await import('./hyperliquid');
  return getHLPositions(evmAddress);
}

export async function getFills(mode: TradeMode, evmAddress: string): Promise<Fill[]> {
  if (mode === 'aster') {
    throw new Error('Aster user info requires API key authentication — not yet supported.');
  }
  const { getUserFills } = await import('./hyperliquid');
  return getUserFills(evmAddress);
}

export async function getOpenOrders(mode: TradeMode, evmAddress: string): Promise<OpenOrder[]> {
  if (mode === 'aster') {
    throw new Error('Aster user info requires API key authentication — not yet supported.');
  }
  const { getOpenOrders: getHLOpenOrders } = await import('./hyperliquid');
  return getHLOpenOrders(evmAddress);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit lib/dex-wrapper.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/dex-wrapper.ts
git commit -m "feat(dex-wrapper): add user info functions (HL only)"
```

---

### Task 6: Add user info hooks to `lib/dex-wrapper-hooks.ts`

**Files:**
- Modify: `lib/dex-wrapper-hooks.ts` (append after market data hooks)

- [ ] **Step 1: Append the four user info hooks**

```typescript
// Add these to lib/dex-wrapper-hooks.ts after useFundingRates

import { getBalance, getPositions, getFills, getOpenOrders } from './dex-wrapper';

export function useBalance(mode: TradeMode, address: string | null) {
  return useQuery({
    queryKey: ['dex', 'balance', mode, address],
    queryFn: () => getBalance(mode, address!),
    enabled: !!address && mode === 'hl',
    refetchInterval: 15_000,
  });
}

export function usePositions(mode: TradeMode, address: string | null) {
  return useQuery({
    queryKey: ['dex', 'positions', mode, address],
    queryFn: () => getPositions(mode, address!),
    enabled: !!address && mode === 'hl',
    refetchInterval: 15_000,
  });
}

export function useFills(mode: TradeMode, address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['dex', 'fills', mode, address],
    queryFn: () => getFills(mode, address!),
    enabled: !!address && enabled && mode === 'hl',
  });
}

export function useOpenOrders(mode: TradeMode, address: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['dex', 'openOrders', mode, address],
    queryFn: () => getOpenOrders(mode, address!),
    enabled: !!address && enabled && mode === 'hl',
  });
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit lib/dex-wrapper-hooks.ts`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add lib/dex-wrapper-hooks.ts
git commit -m "feat(dex-wrapper-hooks): add user info hooks"
```

---

### Task 7: Manual verification of Phase 2

**Files:**
- Read-only: `app/(terminal)/page.tsx`

- [ ] **Step 1: Create a temporary test snippet**

Add a temporary `useEffect` in `app/(terminal)/page.tsx`:

```tsx
// TEMPORARY: Phase 2 verification — remove after testing
import { getBalance, getPositions, getFills, getOpenOrders } from '@/lib/dex-wrapper';

useEffect(() => {
  async function test() {
    const address = '0xYourAddressHere'; // Replace with a real HL address or connected wallet address

    console.log('--- Testing HL balance ---');
    try {
      const balance = await getBalance('hl', address);
      console.log('HL balance:', balance);
    } catch (e) {
      console.error('HL balance error:', e);
    }

    console.log('--- Testing Aster balance (should throw) ---');
    try {
      await getBalance('aster', address);
      console.error('Aster balance should have thrown!');
    } catch (e) {
      console.log('Aster balance correctly threw:', (e as Error).message);
    }

    console.log('--- Testing HL positions ---');
    try {
      const positions = await getPositions('hl', address);
      console.log('HL positions count:', positions.length);
    } catch (e) {
      console.error('HL positions error:', e);
    }

    console.log('--- Testing HL fills ---');
    try {
      const fills = await getFills('hl', address);
      console.log('HL fills count:', fills.length);
    } catch (e) {
      console.error('HL fills error:', e);
    }

    console.log('--- Testing HL open orders ---');
    try {
      const orders = await getOpenOrders('hl', address);
      console.log('HL open orders count:', orders.length);
    } catch (e) {
      console.error('HL open orders error:', e);
    }
  }
  test();
}, []);
```

- [ ] **Step 2: Run dev server and check browser console**

Run: `npm run dev`
Open terminal page, check console.

Expected:
- `getBalance('hl', address)` returns a number (or 0 if address has no balance).
- `getBalance('aster', address)` throws with the expected message.
- `getPositions`, `getFills`, `getOpenOrders` for HL return arrays.

- [ ] **Step 3: Remove temporary test code**

Delete the temporary `useEffect` and import.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: verify Phase 2 dex-wrapper user info"
```

---

## Phase 3: Testnet Trading

### Task 8: Add testnet-aware trading functions to `lib/dex-wrapper.ts`

**Files:**
- Modify: `lib/dex-wrapper.ts` (append after user info functions)

- [ ] **Step 1: Append the three trading functions with testnet support**

```typescript
// Add these to lib/dex-wrapper.ts after getOpenOrders

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

  const { openPosition } = await import('./hyperliquid');

  if (opts.testnet) {
    // Override the HL_API base for testnet
    // We need to temporarily patch the module's internal HL_API
    // Since HL_API is a module-level const in hyperliquid.ts, we can't easily override it.
    // Instead, we'll create a testnet-specific wrapper that uses a different endpoint.
    return placeOrderTestnet(params);
  }

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

  const { closePosition: hlClosePosition } = await import('./hyperliquid');

  if (opts.testnet) {
    return closePositionTestnet(params);
  }

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

  const { cancelOrder: hlCancelOrder } = await import('./hyperliquid');

  if (opts.testnet) {
    return cancelOrderTestnet(params);
  }

  return hlCancelOrder(params);
}
```

- [ ] **Step 2: Add testnet helper functions**

Append the testnet helpers to the same file:

```typescript
// Testnet helpers — these mirror the mainnet functions but use the testnet endpoint
// The signing logic is identical; only the exchange URL changes.

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

// We need to replicate the signing logic from hyperliquid.ts for testnet
// Since the signing functions are not exported, we duplicate the minimal
// testnet-specific signing here. This is the only duplication in the wrapper.

async function placeOrderTestnet(params: OrderParams): Promise<unknown> {
  const price = await getTestnetMarketPrice(params.symbol);
  if (!price) throw new Error('Cannot fetch testnet price for ' + params.symbol);

  const sz = parseFloat((params.sizeDollars / price).toFixed(8));
  const slip = 0.003;
  const limitPx = params.isLong ? price * (1 + slip) : price * (1 - slip);

  // We need the asset index map for testnet — fetch meta first
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

// Minimal msgpack encoder (copied from hyperliquid.ts for testnet signing)
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
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit lib/dex-wrapper.ts`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add lib/dex-wrapper.ts
git commit -m "feat(dex-wrapper): add testnet trading functions"
```

---

### Task 9: Add backend testnet proxy route

**Files:**
- Modify: `server/routes/proxy.js` (or the existing proxy route file in `server/routes/`)

- [ ] **Step 1: Find the actual proxy route file**

Run: `ls server/routes/`
Identify the file that contains the `/proxy/hl/*` route (likely `proxy.js` or `index.js`).

- [ ] **Step 2: Add the testnet proxy route**

Open the proxy route file and add:

```js
fastify.post('/proxy/hl-testnet/*', async (req, reply) => {
  const path = req.params['*'];
  const res = await fetch(`https://api.hyperliquid-testnet.xyz/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req.body),
  });
  return res.json();
});
```

Place this route right after the existing `/proxy/hl/*` route.

- [ ] **Step 3: Add vite dev proxy for testnet**

Open `vite.config.js` and add a testnet proxy rule:

```js
// In the proxy section of vite.config.js, add:
'/api/hl-testnet': {
  target: 'https://api.hyperliquid-testnet.xyz',
  changeOrigin: true,
  rewrite: (path) => path.replace(/^\/api\/hl-testnet/, ''),
},
```

- [ ] **Step 4: Commit**

```bash
git add server/routes/proxy.js vite.config.js
git commit -m "feat(proxy): add Hyperliquid testnet proxy route"
```

---

### Task 10: Manual verification of Phase 3 (testnet trading)

**Files:**
- Read-only: `lib/dex-wrapper.ts`

- [ ] **Step 1: Get testnet USDC from the Hyperliquid faucet**

Visit: `https://app.hyperliquid-testnet.xyz/faucet`
Connect your wallet (same address you'll use for testing) and request testnet USDC.

- [ ] **Step 2: Create a temporary test component or use browser console**

Add a temporary button in the terminal page:

```tsx
// TEMPORARY: Phase 3 verification — remove after testing
import { placeOrder, closePosition } from '@/lib/dex-wrapper';

// Inside your component, add a button:
<button onClick={async () => {
  if (!signer) return;
  console.log('Placing testnet order...');
  const result = await placeOrder('hl', {
    symbol: 'BTC',
    sizeDollars: 10, // Small test size
    leverage: 1,
    isLong: true,
    signer,
  }, { testnet: true });
  console.log('Testnet order result:', result);
}}>
  Testnet Buy $10 BTC
</button>

<button onClick={async () => {
  if (!signer) return;
  console.log('Closing testnet position...');
  const result = await closePosition('hl', {
    symbol: 'BTC',
    size: 0.0001, // Small test size
    isLong: true,
    signer,
  }, { testnet: true });
  console.log('Testnet close result:', result);
}}>
  Testnet Close BTC
</button>
```

- [ ] **Step 3: Run dev server and test**

Run: `npm run dev`
Connect wallet, click "Testnet Buy $10 BTC", check browser console for the result.

Expected: The order should be accepted by the testnet API. Check the response for `status: 'ok'` or similar.

- [ ] **Step 4: Verify on testnet explorer**

Visit: `https://app.hyperliquid-testnet.xyz/explorer`
Search for your wallet address to see the testnet trade.

- [ ] **Step 5: Remove temporary test buttons**

Delete the temporary buttons and imports.

- [ ] **Step 6: Commit**

```bash
git commit -m "chore: verify Phase 3 testnet trading"
```

---

## Plan Self-Review

### Spec Coverage Check

| Spec Section | Plan Task(s) | Status |
|--------------|-------------|--------|
| 5.1 Shared Types (`TradeMode`, `UnifiedMarket`, etc.) | Task 1 | Covered |
| 5.2 Market Data (`getMarkets`, `getBook`, `getCandles`, `getFundingRates`) | Tasks 1-2 | Covered |
| 5.3 User Info (`getBalance`, `getPositions`, `getFills`, `getOpenOrders`) | Task 5 | Covered |
| 5.4 Trading (`placeOrder`, `closePosition`, `cancelOrder` with `testnet` flag) | Task 8 | Covered |
| 5.5 Testnet Behavior | Tasks 8-9 | Covered |
| 6. React Query Hooks (all 8 hooks) | Tasks 3, 6 | Covered |
| 7. Implementation Phases | All tasks | Covered |
| 8. Backend Changes (testnet proxy) | Task 9 | Covered |
| 9. Error Handling | Tasks 5, 8 | Covered |
| 10. Testing Strategy | Tasks 4, 7, 10 | Covered |

### Placeholder Scan

- No "TBD", "TODO", "implement later", "fill in details" found.
- No "Add appropriate error handling" without specifics.
- No "Similar to Task N" references.
- All code blocks contain complete, runnable code.
- All file paths are exact.

### Type Consistency Check

- `TradeMode` is `'hl' | 'aster'` throughout — consistent.
- `UnifiedMarket` fields match spec — consistent.
- `OrderParams`, `CloseParams`, `CancelParams` match spec — consistent.
- `Signer` interface matches `hyperliquid.ts` — consistent.
- Hook names match spec (`useMarkets`, `useBook`, `useCandles`, etc.) — consistent.
- Query keys use `['dex', ...]` prefix — consistent across all hooks.

**No issues found. Plan is complete and ready for execution.**
