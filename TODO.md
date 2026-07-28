# RDO ONE — TODO

**Last updated:** 2026-07-28
**Target:** Desktop only

---

## What Works

- Market + Limit orders (place, close, cancel, modify) — both HL and Aster
- TP/SL triggers (HL: atomic `normalTpsl` grouping · Aster: separate reduce-only triggers)
- Real-time charts, order book, live trades via WebSocket (auto-reconnect)
- Live positions, balances, open orders, trade/funding/order history
- Mode switch: BASIC (Hyperliquid) ↔ EXTRA (Aster DEX)
- Markets overview, news aggregator, portfolio PnL tracker
- Wallet connect via injected providers (MetaMask / Rabby / Phantom)

---

## What Needs to Be Done

### 1. Proper Wallet Connect

**Current state:** `lib/wallet.tsx` only detects injected browser extensions (`window.ethereum`, `window.phantom`). If the user doesn't have MetaMask or Rabby installed, they can't connect at all. No WalletConnect v2, no mobile QR code, no hardware wallet support.

**What to build:**

- **Multi-wallet modal** — A connect modal listing wallet options (MetaMask, Rabby, Coinbase Wallet, WalletConnect QR) instead of silently calling `eth_requestAccounts` on whatever `window.ethereum` is
- **WalletConnect v2 integration** — QR code flow for mobile wallets. Dependencies already in `package.json` (`@walletconnect/ethereum-provider`, `@walletconnect/modal`) but never imported or used. Needs a WalletConnect Cloud `projectId` (free at cloud.walletconnect.com)
- **Network switching** — The `NetworkSwitcher` component exists and calls `wallet_switchEthereumChain`, but needs to work seamlessly with WalletConnect sessions too
- **Session persistence** — Currently uses `localStorage` keys (`rdo_evm_address`, `rdo_sol_address`) and re-checks on mount via `eth_accounts`. WalletConnect sessions need their own persistence via the WC provider
- **Disconnect cleanup** — `disconnect()` calls Phantom's `solana.disconnect()` but for WC sessions needs to also call `provider.disconnect()` on the WC provider
- **Aster agent flow** — `aster-agent.ts` needs the wallet's EIP-712 `signTypedData` to approve the per-user trading agent. Must work through WalletConnect too, not just injected providers

**Files to change:**
- `lib/wallet.tsx` — Add WalletConnect provider, multi-wallet selection logic
- `components/shared/WalletControls.tsx` — Render the connect modal with wallet options
- `components/trade/orderFlow.ts` — Currently gets signer from `getEVMProvider()` → needs to use whichever provider the user connected with
- `lib/aster-agent.ts` — `ensureAsterAgentApproved` calls `getSigner()` → must work with WC provider

### 2. Withdraw & Deposit (Transfer Page)

**Current state:** Transfer page (`app/transfer/page.tsx`) has three tabs: Withdraw, Send, Between-accounts. HL withdrawal works end-to-end (signs via wallet, polls for arrival). LI.FI cross-chain conversion works (quote → approve → execute → poll receipt). Aster withdrawal is wired but untested.

**What's missing:**

- **Deposit flow** — No deposit tab exists. For HL: user needs to send USDC to the HL bridge contract on Arbitrum. For Aster: standard ERC-20 deposit to the Aster contract on BNB Chain. Both need:
  - Show deposit address / contract
  - Token approval tx (if ERC-20)
  - Deposit tx
  - Poll for balance update on the exchange side
- **Aster withdrawal testing** — The `asterWithdrawRaw()` function exists but needs `ASTER_SIGNER_PRIVATE_KEY` configured and hasn't been tested live
- **Error recovery** — If a multi-step flow fails mid-way (e.g. LI.FI conversion after HL withdrawal lands), there's no way to resume — user has tokens sitting in their wallet with no UI to continue the conversion
- **Balance display** — Only HL equity shows. Aster balance and wallet token balances (per chain) should display too

**Files to change:**
- `app/transfer/page.tsx` — Add deposit tab, improve error recovery, show all balances

### 3. Swap

**Current state:** Backend proxy route exists (`/api/swap/*` → 1inch API with server-side `ONEINCH_API_KEY`). Frontend has no swap UI.

**What to build:**

- **Swap tab/page** — Token-in / Token-out selector, amount input, quote display, slippage setting
- **Quote fetching** — `GET /api/swap/quote?src=...&dst=...&amount=...&from=...`
- **Execution** — `GET /api/swap/swap?...` returns tx data → send via wallet → poll receipt
- **Token approval** — Check allowance, prompt approve tx if needed before swap
- **Env var** — `ONEINCH_API_KEY` must be set in `backend/.env` (free key from portal.1inch.dev)

**Files to change:**
- `app/transfer/page.tsx` — Add swap tab (or separate page if cleaner)
- Backend route already exists at `backend/src/routes/swap.ts`

---

## Lower Priority

### Redis
Backend runs without it but all requests hit upstream APIs directly. Under load: CoinGecko 403s, Binance rate limits.
```bash
brew install redis && brew services start redis
```

### Loading state fallbacks
Liq Map, AI Signals, Markets tables show "Loading..." forever on failure. Need timeout + retry button.

### X/Twitter Tracker
Left sidebar placeholder. Needs backend route for Twitter API v2 search + `X_BEARER_TOKEN` env var.

### Chart Indicators
Volume bars (data already there), SMA/EMA, Bollinger Bands, RSI pane.

### Notifications
Order fills, TP/SL triggers, liquidation warnings, price alerts — browser Notification API.

### Keyboard Shortcuts
B=Buy, S=Sell, Esc=close modal, 1-9=quick size.

### Advanced Order Types
Stop-Limit, Trailing Stop, Scaled orders, TWAP.

---

## Environment Variables

| Key | Required for | Status |
|---|---|---|
| `REDIS_URL` | Caching | Optional (graceful fallback) |
| `ALLOWED_ORIGINS` | CORS | Set to `http://localhost:3002,http://localhost:3007` |
| `ONEINCH_API_KEY` | Swap | **Needed** — portal.1inch.dev |
| `ASTER_SIGNER_ADDRESS` | EXTRA mode | **Needed** — Aster Pro API dashboard |
| `ASTER_SIGNER_PRIVATE_KEY` | EXTRA mode | **Needed** — same |
| `AGENT_KEY_ENCRYPTION_SECRET` | Per-user agent keys | **Needed** — any random string |
| `X_BEARER_TOKEN` | X tracker | Optional |

---

## Cleanup Done (2026-07-28)

- [x] Removed `@lifi/widget` dead dependency
- [x] Fixed Markets page `fetchHLPerps` crash
- [x] Updated X Tracker placeholder text
- [x] Fixed nav bar layout (ticker blocks before links, divider heights)
- [x] Bottom panel tabs padding
- [x] Live Trades header aligned
- [x] CORS fix (added localhost:3007 to ALLOWED_ORIGINS)
- [x] Redis `redisOk` flag for rate-limit plugin
