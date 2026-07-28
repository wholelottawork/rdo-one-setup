# RDO ONE — TODO

**Last updated:** 2026-07-29  
**Audited against:** actual codebase (every file read, every flow traced)

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

### 1. Proper Wallet Connect

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

### 2. Deposit Flow

**Problem:** No deposit tab exists on the Transfer page. Users can withdraw and send, but cannot deposit funds into HL or Aster from the app.

**What to build:**

**HL Deposit:**
- HL auto-detects USDC sent to the user's address on Arbitrum — no contract interaction needed
- The "deposit" is just: if funds are already USDC on Arbitrum → done, HL picks them up automatically
- If funds are on another chain/token → LI.FI quote to convert to USDC on Arbitrum → approve → execute → HL auto-credits
- Show: "Send USDC to your address on Arbitrum. HL detects it automatically within ~2 minutes."

**Aster Deposit:**
- `asterDepositAddr()` already exists in `transfer/page.tsx` (line 658) — fetches the user's Aster deposit address via HMAC-signed API call
- Flow: get deposit address → token approval → `erc20Send()` USDT to deposit address → poll Aster balance
- If funds are on wrong chain/token → LI.FI convert to USDT on Arbitrum first → then send to deposit address
- The `erc20Send()` helper already exists (line 582)

**UI:** Add a "Deposit" tab button next to Withdraw/Send/Between. Same card layout with source chain/token selectors, amount input, destination picker (HL or Aster).

**File to change:** `app/transfer/page.tsx` — add tab + logic (all helper functions already exist)

### 3. Swap UI

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

1. **Aster leverage not controllable** — UI leverage picker has no effect on Aster orders. Users think they're setting 5x while Aster uses the account's own default (could be 20x+). Either: add a `POST /aster-signed/fapi/v3/leverage` call before Aster orders (like HL does), or show a warning that leverage follows Aster account settings.
   - File: `orderFlow.ts` line ~169

2. **NetworkSwitcher disconnects instead of switching** — Clicking a different network calls `disconnect()` instead of `wallet_switchEthereumChain`. The `switchEvmNetwork()` function exists in `wallet.tsx` and works, but NetworkSwitcher doesn't use it.
   - File: `components/shared/NetworkSwitcher.tsx` line 86

3. **Disconnect doesn't prevent auto-reconnect** — After disconnect + reload, `eth_accounts` returns the address and the mount effect silently reconnects. Need a `rdo_disconnected` localStorage flag.
   - File: `lib/wallet.tsx` lines 186-253

4. ~~**updateStats uses market price for limit orders**~~ — **FIXED** (`lib/orderMath.ts` + `orderFlow.ts` refactored to use `entryPrice()` which returns limit price when set, mark otherwise. Stats, TP/SL validation, and size-from-percentage all use the correct entry price now.)

5. **Aster modify trigger is not atomic** — `editTrigger()` deletes the old order then places a new one. If the new order fails, the TP/SL is gone with no recovery. Should attempt the new order first, only delete the old one on success (or at minimum, show a clear error that the original was removed).
   - File: `orderFlow.ts` lines 710-733

### Should fix

6. ~~**Reduce-only flag ignored for Aster**~~ — **FIXED** (`orderFlow.ts` Aster order body now includes `reduceOnly: "true"` when checkbox is ticked.)

7. **Aster TP/SL quantity assumes full fill** — TP/SL are placed with the requested `qty`, but partial fills mean the position could be smaller. The triggers would be for more than the position size.
   - File: `orderFlow.ts` lines 208-239

8. **closePosition uses Date.now() instead of nextNonce()** — Could cause nonce collisions on rapid-fire closes. `openPosition` uses `nextNonce()` correctly.
   - File: `lib/trading.ts` line 557

9. ~~**Slippage display always shows "--"**~~ — **FIXED** (`orderFlow.ts` now shows `"0.30% max"` for HL market orders, `"—"` for limits and Aster market orders. Uses exported `MARKET_SLIPPAGE` constant from `trading.ts`.)

10. **Cross Margin Ratio / Maintenance Margin always 0** — `#ovCmr` and `#ovMm` in OrderPanel never get updated values.
    - File: `OrderPanel.tsx` lines 342, 346

11. **Dead WalletConnect dependencies** — `@walletconnect/ethereum-provider` and `@walletconnect/modal` in `package.json` are never imported. Remove them or integrate them (see section 1 above).

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
