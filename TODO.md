# RDO ONE — TODO

**Last updated:** 2026-07-30  
**Audited against:** actual codebase (every file read, every flow traced)

Aster's signed routes (`/aster-signed/*`, `/aster-agent-address`,
`/aster-tpsl-watch`) are behind a wallet-signed session as of 2026-07-30 — one
signature per 12h, HttpOnly cookie after that. They used to take the account to
act on from a client-supplied `user`, which is a public address. See STATUS.md.

---

## What Actually Works (verified in code)

**Trading (both HL + Aster):**
- Market orders — HL uses IOC limit at mark ± 0.3% slippage (HL has no native market order); Aster uses `type: MARKET`
- Limit orders — HL uses `tif: Gtc` with user's exact price; Aster uses `type: LIMIT, timeInForce: GTC`
- TP/SL on new orders — HL bundles entry + triggers atomically via `grouping: normalTpsl`; Aster places separate `TAKE_PROFIT_MARKET` / `STOP_MARKET` reduce-only orders after fill
- TP/SL on existing positions — modal dialog for price input, then standalone reduce-only triggers
- Close position — opposite-side IOC (HL) or opposite-side MARKET (Aster) with reduce-only
- Cancel order — HL: `type: cancel` signed action; Aster: DELETE to `/fapi/v3/order`
- Modify trigger — HL: native `type: modify` action; Aster: cancel-then-replace (not atomic)
- Leverage — HL: per-asset `updateLeverage` action before each order; Aster: uses account default (NOT settable from UI — see bugs)

**Live Data:**
- Chart — Lightweight Charts v5, candles from HL `candleSnapshot` or Aster `/fapi/klines`
- Order book — floating panel with HL `l2Book` or Aster depth
- Live trades — HL via WS relay (`ws://localhost:3001/ws`); Aster direct WS (`wss://fstream.asterdex.com`)
- Price stream — HL `allMids` subscription via backend WS relay with auto-reconnect + 50s keepalive ping

**Bottom Tabs (both modes):**
- Positions — fetches + renders open positions, with close/TP-SL actions
- Balances — spot + perps equity display
- Open Orders — with cancel buttons
- Trade History — grouped fills
- Funding History — HL funding payments / Aster income
- Order History — filled/cancelled orders
- Liq Map — liquidation heatmap (placeholder data)

**Transfer Page (3 tabs):**
- **Withdraw** — HL withdrawal works end-to-end (EIP-712 sign → poll balance arrival → optional LI.FI conversion to any token/chain). Aster withdrawal wired (`asterWithdrawRaw` with HMAC signing) but needs API credentials
- **Send** — Cross-chain send via LI.FI: quote with fee/gas/route display → token approval → `eth_sendTransaction` → done. Fully functional
- **Between Accounts** — HL↔Aster transfer: withdraw from source → poll arrival → LI.FI swap USDC↔USDT → send to destination. Full multi-step flow with progress UI

**Sub-Pages:**
- Markets — CoinGecko trending + HL perps meta table
- News — 8 RSS feeds aggregated via backend
- Portfolio — PnL calendar + position tracker (both venues)

**Backend:**
- HL proxy — POST `/api/hl/*` → api.hyperliquid.xyz, with Redis caching
- Aster proxy — market data + HMAC-signed endpoints for positions/orders/agent
- Market data — cached proxies for Binance, CoinGecko, Fear&Greed, LI.FI
- Swap — 1inch proxy with 3 endpoints: `/api/swap/quote`, `/api/swap/build`, `/api/swap/tokens` (needs `ONEINCH_API_KEY`)
- News — aggregated RSS from 8 sources + per-source proxies + image proxy
- WebSocket relay — two WS servers: `/ws` (HL with 50s ping keepalive) and `/aster-stream` (Aster with spoofed headers)
- Redis — graceful fallback with `redisOk` flag
- Rate limiting — 200 req/min per IP
- CORS — origin allowlist from env

---

## What Needs to Be Built

### 1. ~~Proper Wallet Connect~~ — **BUILT** (`e2fe859`)

Chooser lists every detected wallet plus WalletConnect v2 (needs
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`). Routing turned out to be one variable:
every signing path already resolved through `getEVMProvider()`, so connect sets
an `activeProvider` that accessor returns. Disconnect sticks. Original writeup
below for reference.

**Problem:** `lib/wallet.tsx` only detects injected browser extensions (`window.ethereum`, `window.phantom`). No wallet chooser UI — `connect()` blindly calls `eth_requestAccounts` on whatever provider exists. If the user has multiple wallets installed, they can't pick which one. If they have no extension installed, they see "install Phantom or MetaMask" and are stuck.

WalletConnect v2 packages (`@walletconnect/ethereum-provider`, `@walletconnect/modal`) are in `package.json` but **never imported anywhere** — dead dependencies.

**What to build:**

1. **Wallet connect modal** — On clicking "Connect", show a modal listing:
   - MetaMask (if `window.ethereum` with no `isPhantom`)
   - Phantom (if `window.phantom`)
   - Coinbase Wallet (if `window.coinbaseWalletExtension`)
   - Rabby (if detected)
   - WalletConnect QR — for any mobile wallet
   Each option calls the correct provider. Store which provider type was used so all subsequent signing calls go through it.

2. **WalletConnect v2 provider** — Initialize `EthereumProvider.init({ projectId, chains, showQrModal: true })` from `@walletconnect/ethereum-provider`. Get a free `projectId` at cloud.walletconnect.com. The provider implements the same EIP-1193 interface as injected wallets, so all existing signing code (`eth_signTypedData_v4`, `eth_sendTransaction`) works unchanged.

3. **Provider routing** — Store the active provider instance (injected OR WalletConnect) in the WalletContext. Every call site that currently does `getEVMProvider()` (which returns `window.ethereum`) must use the Context's provider instead. Key call sites:
   - `orderFlow.ts` line ~256: gets ethers signer from `getEVMProvider()` for HL order signing
   - `aster-agent.ts`: `ensureAsterAgentApproved` → `getSigner()` for EIP-712 agent approval
   - `transfer/page.tsx`: `getProv()` for withdrawal/send/between tx signing
   - `NetworkSwitcher.tsx`: calls `wallet_switchEthereumChain` on the provider

4. **Session persistence** — WalletConnect sessions persist via the WC provider's internal storage. On reload, call `provider.enable()` to restore. For injected wallets, the current `eth_accounts` check works but has a bug: after explicit disconnect + reload, `eth_accounts` still returns the address (the extension stays authorized), silently reconnecting the user. Fix: set a `rdo_disconnected` flag in localStorage on disconnect, skip auto-reconnect when it's set.

5. **Disconnect** — For WC sessions, call `provider.disconnect()` to kill the WC session. For injected, current behavior (clear app state only) is fine. Clear the `rdo_disconnected` flag on explicit connect.

**Files to change:**
- `lib/wallet.tsx` — Add WC provider init, multi-provider tracking, fix disconnect persistence
- `components/shared/WalletControls.tsx` — Render connect modal with wallet options
- `components/trade/orderFlow.ts` — Replace `getEVMProvider()` calls with Context provider
- `lib/aster-agent.ts` — `getSigner()` must use the active provider
- `app/transfer/page.tsx` — `getProv()` must use the active provider

### 2. ~~Deposit Flow~~ — **BUILT**

Deposit tab added to the Transfer page (`app/transfer/page.tsx`), destination picker for HL or Aster.

- **HL** — native USDC on Arbitrum transferred to Bridge2 (`0x2df1c51e09aecf9cacb7bc98cb1742757f163df7`), credited to the sending EOA in ~1 min. **HL does not auto-detect USDC sitting in the wallet** — the earlier note in this file claiming that was wrong. Deposits under 5 USDC are swallowed by the bridge, so `execDeposit()` refuses them.
- **Aster** — `asterDepositAddr()` (HMAC-signed) → `erc20Send()` USDT to that address.
- **Any other chain/token** — LI.FI converts to USDC/USDT on Arbitrum first, then only the converted delta is forwarded (never the wallet's whole balance).

Same fix applied to the EXTRA → BASIC leg of **Between Accounts**, which previously reported "Transfer complete" while the swapped USDC sat in the wallet, never reaching Hyperliquid.

**Still open:** no MAX button / wallet balance readout on the deposit tab (needs per-token balance reads incl. native).

### 3. ~~Swap UI~~ — **BUILT** (`716497d`)

Swap tab on the Transfer page: network, pay/receive, debounced quote, build →
allowance → send → receipt. Still needs `ONEINCH_API_KEY` — the tab now says so
instead of showing a bare error. Uses the page's curated `CHAINS` token list
rather than 1inch's full one (thousands per chain, would need a searchable
picker). Original writeup below.

**Problem:** Backend has a complete 1inch proxy (`/api/swap/quote`, `/api/swap/build`, `/api/swap/tokens`) but the frontend has zero swap interface.

**What to build:**

1. **Swap tab or page** — token-in selector, token-out selector, amount input, quote display (output amount, gas, price impact)
2. **Quote flow** — `GET /api/swap/quote?chainId=42161&src=TOKEN_A&dst=TOKEN_B&amount=X&from=USER` → display estimated output
3. **Execute flow** — `GET /api/swap/build?...&slippage=1` → returns unsigned tx data → check/set token approval → `eth_sendTransaction` with the tx data → poll receipt
4. **Token list** — `GET /api/swap/tokens?chainId=42161` → populate dropdowns (cached 1hr server-side)

**Prerequisite:** Set `ONEINCH_API_KEY` in `backend/.env` (free at portal.1inch.dev). Without it, all swap endpoints return 503.

**File to change:** `app/transfer/page.tsx` — add Swap tab (or a new page). Backend is done.

---

## Bugs Found in Audit

### Must fix

1. ~~**Aster leverage not controllable**~~ — **FIXED** (`orderFlow.ts` posts `/aster-signed/fapi/v3/leverage` before every Aster entry and aborts the order if Aster refuses, rather than filling at a leverage the user didn't pick. Skipped on reduce-only, where it's irrelevant and Aster can reject the change.)

2. ~~**NetworkSwitcher disconnects instead of switching**~~ — **FIXED** (`e2fe859`: NetworkSwitcher calls the `switchEvmNetwork()` that already existed in `wallet.tsx`, instead of logging the user out for picking a chain.)

3. ~~**Disconnect doesn't prevent auto-reconnect**~~ — **FIXED** (`e2fe859`: a `rdo_disconnected` localStorage flag blocks the mount effect's auto-restore.)

4. ~~**updateStats uses market price for limit orders**~~ — **FIXED** (`lib/orderMath.ts` + `orderFlow.ts` refactored to use `entryPrice()` which returns limit price when set, mark otherwise. Stats, TP/SL validation, and size-from-percentage all use the correct entry price now.)

5. ~~**Aster modify trigger is not atomic**~~ — **FIXED** (`editTrigger()` now places the replacement first and cancels the old trigger only on success, so a rejected placement leaves the original protection intact. A failed cancel is reported as its own outcome — "placed, but the old one is still open" — rather than as a failed edit.)

### Should fix

6. ~~**Reduce-only flag ignored for Aster**~~ — **FIXED** (`orderFlow.ts` Aster order body now includes `reduceOnly: "true"` when checkbox is ticked.)

7. ~~**Aster TP/SL quantity assumes full fill**~~ — **FIXED** (triggers now use `closePosition: true`, which closes whatever is actually open when it fires, so no quantity is guessed. For limit orders they're no longer placed up front either — a trigger on an unfilled limit fires against nothing and is consumed, leaving the later fill naked; `waitForFill()` holds them until the first execution. `fillState()` in `lib/orderMath.ts` is covered by `npm test`.)
   - Ceiling: the fill watcher lives in the browser tab, so a reload drops it. A backend watcher is the upgrade.

8. ~~**closePosition uses Date.now() instead of nextNonce()**~~ — **FIXED** (`closePosition`, `cancelOrder`, `modifyTriggerOrder` and the standalone TP/SL path all built nonces from raw `Date.now()`, not just `closePosition` — every signed HL action now routes through `nextNonce()`.)

9. ~~**Slippage display always shows "--"**~~ — **FIXED** (`orderFlow.ts` now shows `"0.30% max"` for HL market orders, `"—"` for limits and Aster market orders. Uses exported `MARKET_SLIPPAGE` constant from `trading.ts`.)

10. ~~**Cross Margin Ratio / Maintenance Margin always 0**~~ — **FIXED** (`2aae6cc`: both render for both venues. HL keeps `crossMaintenanceMarginUsed` at the *top level* of clearinghouseState, not in either margin summary — which is why it was missed.)

11. ~~**Dead WalletConnect dependencies**~~ — **FIXED** (`e2fe859`: integrated, not removed. WalletConnect v2 appears in the wallet chooser when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set.)

---

## Environment Variables

| Key | Status | Purpose |
|---|---|---|
| `ALLOWED_ORIGINS` | `http://localhost:3002,http://localhost:3007` | CORS whitelist |
| `REDIS_URL` | `redis://localhost:6379` | Cache (optional, graceful fallback) |
| `ONEINCH_API_KEY` | **Empty — needed for swap** | portal.1inch.dev (free) |
| `ASTER_SIGNER_ADDRESS` | **Empty — needed for EXTRA mode** | Aster Pro API dashboard |
| `ASTER_SIGNER_PRIVATE_KEY` | **Empty — needed for EXTRA mode** | Aster Pro API dashboard |
| `AGENT_KEY_ENCRYPTION_SECRET` | **Empty — needed for per-user agent keys** | Any random string |
| `X_BEARER_TOKEN` | Optional | X/Twitter tracker (placeholder panel) |

---

## Lower Priority (future)

- **X/Twitter Tracker** — sidebar placeholder, needs Twitter API v2 backend route
- **Chart indicators** — volume bars (data exists), SMA/EMA, Bollinger, RSI
- **Notifications** — order fills, TP/SL triggers, liquidation warnings (browser Notification API)
- **Keyboard shortcuts** — B=Buy, S=Sell, Esc=close, 1-9=size presets
- **Advanced order types** — Stop-Limit, Trailing Stop, Scaled orders, TWAP
- **Status bar** — WS connection status, mode indicator, backend health dot
- **Loading fallbacks** — timeout + retry button for Liq Map, Markets tables
- **Error feedback** — surface silently-swallowed errors (Aster account refresh, RSS failures)
