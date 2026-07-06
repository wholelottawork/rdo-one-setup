# Aster + Hyperliquid Unified Wrapper — Design Spec

**Date:** 2026-07-06  
**Status:** Approved  
**Scope:** Phase 1 (market data), Phase 2 (user info), Phase 3 (testnet trading)  

---

## 1. Context

RDO ONE is a trading terminal that supports two DEX modes:
- **BASIC** → Hyperliquid (`hl`) — full perp trading, user portfolio, on-chain signing
- **EXTRA** → Aster (`aster`) — read-only market data (tickers, order books, candles)

The app uses a `TradeMode = 'hl' | 'aster'` enum passed as props across pages. Currently, every component branches manually: `isAster ? useAsterTickers() : useHLTickers()`. This spec introduces a unified wrapper that accepts `mode` as a first-class parameter.

---

## 2. Goals

1. Provide a single import point for all DEX interactions, parameterized by `TradeMode`.
2. Eliminate scattered `isAster ? ... : ...` conditionals in UI components.
3. Enable safe testnet trading on Hyperliquid without risking real funds.
4. Keep existing `lib/aster.ts` and `lib/hyperliquid.ts` untouched — pure delegation.
5. Add React Query hooks that follow the existing `hl-hooks.ts` / `aster-hooks.ts` pattern.

---

## 3. Non-Goals

- Replacing or refactoring `lib/aster.ts` or `lib/hyperliquid.ts`.
- Adding Aster API-key auth for user info (out of scope; Aster currently has no user-state integration).
- Adding a 3rd DEX (no plugin architecture needed yet).
- Migrating all UI components in one go (migration is Phase 4, separate from wrapper implementation).

---

## 4. Architecture

```
lib/
├── aster.ts              ← unchanged (Aster REST API helpers)
├── hyperliquid.ts        ← unchanged (HL REST + signing)
├── dex-wrapper.ts        ← NEW: mode-aware unified API
└── dex-wrapper-hooks.ts  ← NEW: React Query hooks
```

### 4.1 Design Principles

- **Pure delegation:** `dex-wrapper.ts` calls into `aster.ts` or `hyperliquid.ts`. No duplicated logic.
- **Fail fast:** If a function is called with an unsupported mode, throw a clear error immediately.
- **Testnet is an opt-in flag:** Only trading functions accept `testnet?: boolean`. Market data always uses mainnet (testnet has thin liquidity).
- **Match existing patterns:** Hooks follow the same `useQuery` structure, refetch intervals, and `enabled` guards as `hl-hooks.ts`.

---

## 5. API Specification

### 5.1 Shared Types

```ts
// lib/dex-wrapper.ts

export type TradeMode = 'hl' | 'aster';

export interface UnifiedMarket {
  symbol: string;        // e.g. "BTC"
  price: number;         // last / mark price
  priceChange24h: number; // percent change
  volume24h: number;     // 24h notional volume
  fundingRate8h: number; // 8h funding rate (percent)
  openInterest: number;  // USD notional OI
  maxLeverage: number;   // max allowed leverage
}

export interface OrderBook {
  asks: Array<{ px: number; sz: number }>;
  bids: Array<{ px: number; sz: number }>;
}

export interface Candle {
  t: number; // timestamp ms
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
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

export interface OrderParams {
  symbol: string;
  sizeDollars: number;
  leverage: number;
  isLong: boolean;
  signer: Signer; // from lib/hyperliquid.ts
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

export interface Signer {
  signTypedData(domain: unknown, types: unknown, value: unknown): Promise<string>;
}
```

### 5.2 Market Data (Both Modes)

```ts
// Returns unified market list for the given mode.
// HL: merges meta + assetCtxs. Aster: maps 24hr tickers.
export async function getMarkets(mode: TradeMode): Promise<UnifiedMarket[]>;

// Returns L2 order book for a symbol.
// HL: getL2Book(symbol). Aster: getAsterBook(symbol).
export async function getBook(mode: TradeMode, symbol: string): Promise<OrderBook>;

// Returns OHLCV candles.
// HL: getCandles(symbol, interval, 200). Aster: getAsterCandles(symbol, interval, 200).
export async function getCandles(
  mode: TradeMode,
  symbol: string,
  intervalMinutes: number
): Promise<Candle[]>;

// Returns funding rates per symbol.
// HL: from metaAndAssetCtxs. Aster: from premiumIndex.
export async function getFundingRates(mode: TradeMode): Promise<Record<string, number>>;
```

### 5.3 User Info (HL Only)

```ts
// Throws if mode === 'aster' with message:
// "Aster user info requires API key authentication — not yet supported."
export async function getBalance(mode: TradeMode, evmAddress: string): Promise<number>;
export async function getPositions(mode: TradeMode, evmAddress: string): Promise<Position[]>;
export async function getFills(mode: TradeMode, evmAddress: string): Promise<Fill[]>;
export async function getOpenOrders(mode: TradeMode, evmAddress: string): Promise<OpenOrder[]>;
```

### 5.4 Trading (HL Only, Testnet Opt-In)

```ts
// All three throw if mode === 'aster'.
// If opts.testnet === true, use HL testnet endpoint instead of mainnet.
export async function placeOrder(
  mode: TradeMode,
  params: OrderParams,
  opts?: { testnet?: boolean }
): Promise<unknown>;

export async function closePosition(
  mode: TradeMode,
  params: CloseParams,
  opts?: { testnet?: boolean }
): Promise<unknown>;

export async function cancelOrder(
  mode: TradeMode,
  params: CancelParams,
  opts?: { testnet?: boolean }
): Promise<unknown>;
```

### 5.5 Testnet Behavior

- `testnet: true` swaps the exchange API base from `/api/hl/exchange` to `/api/hl-testnet/exchange`.
- A new backend proxy route `/api/hl-testnet/*` → `https://api.hyperliquid-testnet.xyz/*` is required (Phase 3).
- Testnet uses the same EIP-712 signing scheme as mainnet.
- Users must fund their testnet account via the HL testnet faucet before placing orders.
- **Market data (getMarkets, getBook, etc.) always uses mainnet** regardless of `testnet` flag.

---

## 6. React Query Hooks

**New file:** `lib/dex-wrapper-hooks.ts`

All hooks accept `mode: TradeMode` as the first parameter. They delegate to `dex-wrapper.ts` and follow the same patterns as `hl-hooks.ts` / `aster-hooks.ts`.

```ts
'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getMarkets, getBook, getCandles, getFundingRates,
  getBalance, getPositions, getFills, getOpenOrders,
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

---

## 7. Implementation Phases

### Phase 1 — Market Data Wrapper

**Files:** `lib/dex-wrapper.ts` (market data functions only)

1. Implement `getMarkets`, `getBook`, `getCandles`, `getFundingRates`.
2. `getMarkets('hl')` — call `getHLTickers()` from `lib/hyperliquid.ts`, map to `UnifiedMarket[]`.
3. `getMarkets('aster')` — call `getAsterTickers()` from `lib/aster.ts`, map to `UnifiedMarket[]`.
4. `getBook` / `getCandles` / `getFundingRates` — direct delegation with mode switch.
5. Add unit tests or at least manual verification in a temporary page component.

### Phase 2 — User Info Wrapper

**Files:** `lib/dex-wrapper.ts` (add user info functions), `lib/dex-wrapper-hooks.ts`

1. Implement `getBalance`, `getPositions`, `getFills`, `getOpenOrders`.
2. All four throw on `mode === 'aster'`.
3. Create `lib/dex-wrapper-hooks.ts` with all hooks from Section 6.
4. Verify hooks in a temporary test component.

### Phase 3 — Testnet Trading

**Files:** `lib/dex-wrapper.ts` (add trading functions), `server/routes/proxy.js` (add testnet route)

1. Implement `placeOrder`, `closePosition`, `cancelOrder`.
2. Add `testnet?: boolean` option to all three.
3. When `testnet: true`, use `/api/hl-testnet/exchange` instead of `/api/hl/exchange`.
4. Add backend proxy route: `POST /api/hl-testnet/*` → `https://api.hyperliquid-testnet.xyz/*`.
5. Document testnet faucet usage for the user.

### Phase 4 — UI Migration (Optional, Separate Task)

**Files:** `app/(terminal)/page.tsx`, `app/(portfolio)/portfolio/page.tsx`, etc.

1. Replace `isAster ? useAsterTickers() : useHLTickers()` with `useMarkets(mode)`.
2. Replace `isAster ? useAsterBook() : useHLBook()` with `useBook(mode, symbol)`.
3. Migrate other conditional hook calls similarly.
4. Remove now-unused direct imports from `aster-hooks.ts` / `hl-hooks.ts` where covered by wrapper.

---

## 8. Backend Changes (Phase 3)

**File:** `server/routes/proxy.js` (or the existing proxy route file — check `server/routes/` for the actual filename)

Add a new proxy route for Hyperliquid testnet:

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

No Redis caching for testnet (low volume, needs real-time responses).

---

## 9. Error Handling

| Scenario | Behavior |
|----------|----------|
| `getBalance('aster', ...)` | `throw new Error('Aster user info requires API key authentication — not yet supported.')` |
| `placeOrder('aster', ...)` | `throw new Error('Aster perp trading is not supported.')` |
| `placeOrder('hl', ..., { testnet: true })` with no testnet proxy | Network error from fetch (standard) |
| Testnet API returns error | Pass through raw response (same as mainnet) |
| Aster REST API fails | Return empty array / safe default (matches existing `aster.ts` behavior) |
| HL REST API fails | Return empty array / 0 / null (matches existing `hyperliquid.ts` behavior) |

---

## 10. Testing Strategy

### Phase 1 — Manual
1. Open terminal page, switch between BASIC and EXTRA modes.
2. Verify `getMarkets('hl')` and `getMarkets('aster')` return expected shapes.
3. Check `getBook`, `getCandles`, `getFundingRates` for both modes.

### Phase 2 — Manual
1. Connect wallet on terminal page.
2. Call `getBalance('hl', address)` — should return USDC balance.
3. Call `getPositions('hl', address)` — should return open positions.
4. Verify `getBalance('aster', address)` throws correctly.

### Phase 3 — Testnet
1. Get testnet USDC from HL faucet.
2. Call `placeOrder('hl', params, { testnet: true })` with small size.
3. Verify order appears in testnet clearinghouse state.
4. Call `closePosition` and `cancelOrder` on testnet.
5. Confirm no real funds were used.

---

## 11. Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Testnet or mainnet for testing? | Hyperliquid testnet (`api.hyperliquid-testnet.xyz`) with USDC faucet. |
| Wrapper architecture? | Thin glue layer (`lib/dex-wrapper.ts`) — keeps existing modules untouched. |
| Implementation order? | Phase 1 (market data) → Phase 2 (user info) → Phase 3 (testnet trading). |
| UI migration? | Phase 4 — separate task, not part of wrapper implementation. |

---

## 12. Dependencies

No new npm dependencies. The wrapper reuses:
- `@tanstack/react-query` (already in project)
- `ethers` (already in project, for signing)
- Existing `lib/aster.ts` and `lib/hyperliquid.ts` functions

---

*End of spec.*
