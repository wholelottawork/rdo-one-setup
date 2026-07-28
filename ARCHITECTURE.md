# RDO ONE — Architecture & Integration Guide

**Stack:** Next.js 15 + React 19 + TypeScript (frontend) / Fastify + TypeScript + Redis (backend)
**Exchanges:** Hyperliquid (BASIC mode) / Aster DEX (EXTRA mode)
**Target:** Desktop only

---

## Overview

RDO ONE is a dual-exchange perpetuals trading terminal. The frontend is a Next.js app that proxies all API calls through a Fastify backend. The backend adds Redis caching, rate limiting, CORS, and server-side signing for Aster DEX.

```
Browser (localhost:3007)
  │
  ├── Next.js rewrites (/api/hl/*, /aster-fapi/*, /coingecko/*, etc.)
  │       │
  │       ▼
  │   Fastify backend (localhost:3001)
  │       ├── Redis cache (localhost:6379, optional)
  │       ├── Hyperliquid API (api.hyperliquid.xyz)
  │       ├── Aster DEX API (fapi.aster.trade)
  │       ├── Binance API (api.binance.com)
  │       ├── CoinGecko API (api.coingecko.com)
  │       ├── LI.FI API (li.quest)
  │       └── 1inch API (api.1inch.dev)
  │
  └── WebSocket (direct)
      ├── Hyperliquid WS (wss://api.hyperliquid.xyz/ws)
      └── Aster WS (wss://fstream.aster.trade/ws)
```

---

## Frontend Architecture

### Entry Point & Init Flow

The main trade page (`app/page.tsx`) renders `TradingTerminal.tsx`, which is the largest component (~42K lines). It uses an imperative init pattern: a single `useEffect` dynamically imports all modules and wires them together via closure.

**Init sequence:**
1. Import trading, chart, i18n, toast modules
2. Create module instances: `marketList`, `marketFeed`, `orderFlow`, `bottomTabs`
3. Fetch HL meta (universe of tradeable assets + leverage tiers)
4. Init chart (Lightweight Charts v5)
5. Load default market (BTC) — candles, book, trades
6. Start WebSocket price stream
7. Apply i18n translations

### Module Breakdown

| Module | File | Responsibility |
|---|---|---|
| **TradingTerminal** | `components/TradingTerminal.tsx` | Main orchestrator, mode switch, market switch, wallet bridge |
| **marketList** | `components/trade/marketList.ts` | Market dropdown, symbol search, HL/Aster market polling |
| **marketFeed** | `components/trade/marketFeed.ts` | WS price/book/trades, candle loading, depth updates |
| **orderFlow** | `components/trade/orderFlow.ts` | Order placement (market/limit), close, cancel, modify, TP/SL |
| **bottomTabs** | `components/trade/bottomTabs.ts` | Positions, balances, open orders, trade/funding/order history |
| **chart** | `lib/chart.ts` | Lightweight Charts v5 wrapper, candle push, crosshair |
| **trading** | `lib/trading.ts` | HL REST API client, EIP-712 signing, account state |
| **wallet** | `lib/wallet.tsx` | React Context provider, MetaMask/Rabby/WalletConnect v2 |
| **format** | `lib/format.ts` | Price/size formatting, countdown timers |
| **i18n** | `lib/i18n.ts` | EN/RU/ZH translation strings |
| **toast** | `lib/toast.ts` | Toast notification system |

### React Components (JSX)

| Component | File | What it renders |
|---|---|---|
| **TradeHeader** | `components/trade/TradeHeader.tsx` | Top nav: logo, BASIC/EXTRA toggle, market picker, stats, nav links |
| **ChartPanel** | `components/trade/ChartPanel.tsx` | Chart container + timeframe buttons + indicators toggle |
| **OrderPanel** | `components/trade/OrderPanel.tsx` | Buy/Long + Sell/Short, Market/Limit tabs, size input, TP/SL, leverage |
| **TradesPanel** | `components/trade/TradesPanel.tsx` | Live trades feed (right sidebar) |
| **BottomPanel** | `components/trade/BottomPanel.tsx` | Positions/Balances/Orders/History tabs |
| **FloatingOrderBook** | `components/trade/FloatingOrderBook.tsx` | Order book overlay |
| **XTrackerPanel** | `components/trade/XTrackerPanel.tsx` | X/Twitter sidebar (placeholder) |
| **TradeModals** | `components/trade/TradeModals.tsx` | Close/modify/TP-SL modals |

### Sub-Pages

| Page | File | Data Source |
|---|---|---|
| **Markets** | `app/markets/page.tsx` | CoinGecko trending + HL perps meta |
| **News** | `app/news/page.tsx` | 8 RSS feeds via backend proxy |
| **Portfolio** | `app/portfolio/page.tsx` | HL positions + PnL calendar + Aster balances |
| **Transfer** | `app/transfer/page.tsx` | Withdraw (HL done, Aster wired) · Deposit (not built) · Swap (backend only) |

### Next.js Proxy Rewrites

All API calls go through `next.config.js` rewrites to the backend at `BACKEND_URL` (default `http://localhost:3001`). Key routes:

- `/api/hl/*` → Hyperliquid proxy
- `/aster-fapi/*` → Aster market data
- `/aster-signed/*` → Aster signed endpoints (positions, orders)
- `/api/coingecko/*` → CoinGecko cached proxy
- `/api/binance/*` → Binance cached proxy
- `/lifi-api/*` → LI.FI quote/execute
- `/swap/*` → 1inch with server-side API key
- `/news`, `/ctnews/*`, `/cdnews/*`, etc. → RSS feed proxies

---

## Backend Architecture

### Entry Point

`backend/src/index.ts` — Fastify app with plugin registration:

1. CORS plugin (allowlist from `ALLOWED_ORIGINS` env)
2. Rate limit plugin (200 req/min per IP, configurable)
3. Redis plugin (graceful degradation — runs without Redis)
4. All route plugins registered under `/api` prefix

### Routes

| Route File | Endpoints | Upstream |
|---|---|---|
| **hl.ts** | `POST /api/hl/*` | api.hyperliquid.xyz |
| **aster.ts** | `GET/POST /api/aster-fapi/*`, `/api/aster-signed/*`, `/api/aster-oi-bulk`, `/api/aster-leverage-brackets`, `/api/aster-approve-agent`, `/api/aster-agent-address` | fapi.aster.trade |
| **market-data.ts** | `GET /api/binance/*`, `/api/coingecko/*`, `/api/feargreed/*`, `/api/lifi-api/*` | Various APIs |
| **swap.ts** | `GET /api/swap/*` | api.1inch.dev (needs ONEINCH_API_KEY) |
| **news.ts** | `GET /api/news` | Aggregated from 8 RSS sources |
| **rss.ts** | `GET /api/ctnews/*`, `/api/cdnews/*`, etc. | Per-source RSS proxies |
| **health.ts** | `GET /health` | Self (health check) |

### Plugins

| Plugin | File | What it does |
|---|---|---|
| **cors** | `plugins/cors.ts` | Origin allowlist from `ALLOWED_ORIGINS` env var. Empty = allow all. |
| **rate-limit** | `plugins/rate-limit.ts` | 200 req/min per IP (configurable via env) |
| **redis** | `plugins/redis.ts` | Connects to Redis. Falls back gracefully if unavailable. |

### Libraries

| Library | File | What it does |
|---|---|---|
| **cache** | `lib/cache.ts` | Redis TTL read-through cache |
| **cached-proxy** | `lib/cached-proxy.ts` | Factory for cached GET proxy routes |
| **fetcher** | `lib/fetcher.ts` | fetch() with retry + timeout |
| **rss-parser** | `lib/rss-parser.ts` | Zero-dependency RSS/Atom parser |
| **aster-auth** | `lib/aster-auth.ts` | HMAC-SHA256 request signing for Aster v3 API |
| **agent-keystore** | `lib/agent-keystore.ts` | Encrypted per-user Aster agent key storage |

### WebSocket Relay

`ws/relay.ts` — fans out upstream WS connections to browser clients. Handles both HL and Aster WebSocket protocols.

---

## Trading Flow

### Hyperliquid (BASIC Mode)

1. **Connect wallet** → MetaMask/Rabby signs EIP-712 typed data
2. **Place order** → `trading.ts:openPosition()` builds HL order action, signs with EIP-712, POSTs to `/api/hl/exchange`
3. **TP/SL** → HL native `grouping: 'normalTpsl'` bundles entry + triggers atomically
4. **Positions** → `loadAccountState()` fetches from `/api/hl/info` with `type: 'clearinghouseState'`
5. **Candles** → `/api/hl/info` with `type: 'candleSnapshot'`, pushed to Lightweight Charts
6. **Live price** → WebSocket subscription to `allMids` channel

### Aster DEX (EXTRA Mode)

1. **Connect wallet** → Same wallet, but needs agent approval (one-time EIP-712 signature)
2. **Agent approval** → `aster-agent.ts` signs approval message, sends to `/aster-approve-agent`
3. **Place order** → `orderFlow.ts` signs order with agent private key (HMAC-SHA256), POSTs to `/aster-signed/order`
4. **TP/SL** → Separate reduce-only trigger orders (no atomic grouping like HL)
5. **Positions** → `/aster-signed/positionRisk` with HMAC signature
6. **Candles** → `/aster-fapi/klines` (Binance-compatible format)
7. **Live price** → Aster WebSocket (`fstream.aster.trade/ws`)

### Mode Switch

`TradingTerminal.tsx:switchMode()` toggles between `"hl"` and `"aster"`:
- Updates CSS class on body (`mode-aster`)
- Swaps market to BTC (default for both)
- Rebuilds market dropdown with venue-specific symbols
- Reconnects WebSocket feeds to correct upstream
- Adjusts leverage limits (HL max varies per asset, Aster max 200x)
- Updates fee display

---

## Environment Variables

### Required for core functionality

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Backend listen port |
| `ALLOWED_ORIGINS` | `` (allow all) | Comma-separated frontend origins (e.g. `http://localhost:3002,http://localhost:3007`) |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection. Without Redis, all requests hit upstream directly. |

### Required for specific features

| Variable | Feature | How to get |
|---|---|---|
| `ONEINCH_API_KEY` | Token swaps on Transfer page | [portal.1inch.dev](https://portal.1inch.dev) |
| `ASTER_SIGNER_ADDRESS` | EXTRA mode trading | Aster Pro API dashboard |
| `ASTER_SIGNER_PRIVATE_KEY` | EXTRA mode trading | Aster Pro API dashboard |
| `AGENT_KEY_ENCRYPTION_SECRET` | Per-user Aster agent keys | Any random string |
| `X_BEARER_TOKEN` | X/Twitter tracker | Twitter developer account |

---

## Running Locally

```bash
# 1. Backend
cd backend
cp .env.example .env    # Edit with your keys
npm install
npx tsx src/index.ts    # Runs on :3001

# 2. Redis (optional but recommended)
brew install redis && brew services start redis

# 3. Frontend
cd frontend
npm install
npm run dev:preview     # Runs on :3007
```

---

## What Needs to Be Added / Fixed

See `TODO.md` for the full breakdown with file paths and implementation details. Summary:

### Must Build
1. **Proper wallet connect** — Multi-wallet modal + WalletConnect v2 QR flow. WC deps in `package.json` are unused. All signing paths must work through the chosen provider.
2. **Deposit flow** — No deposit tab. HL auto-detects USDC on Arbitrum; Aster needs `asterDepositAddr()` (already exists) + ERC-20 send.
3. **Swap UI** — Backend 1inch proxy complete (`/api/swap/quote`, `/build`, `/tokens`). Frontend has no UI. Needs `ONEINCH_API_KEY`.

### Must Fix
- Aster leverage not controllable from UI (uses account default silently)
- NetworkSwitcher disconnects instead of actually switching chains
- Disconnect doesn't prevent auto-reconnect on reload
- Stats panel uses market price even when limit price is entered
- Aster modify-trigger deletes before replacing (not atomic)

### Should Fix
- Reduce-only flag ignored for Aster orders
- Aster TP/SL assumes full fill (partial fills → oversized triggers)
- Slippage / Cross Margin Ratio / Maintenance Margin displays always show placeholder values

### Production Deployment

- **Frontend:** Vercel or Cloudflare Pages
- **Backend:** Railway, Render, or VPS with PM2
- **Domain:** Set `BACKEND_URL` env to production backend URL
- **CORS:** Set `ALLOWED_ORIGINS` to production frontend domain only
- **SSL:** Both frontend and backend need HTTPS in production

---

## File Structure

```
rdo-one-setup/
├── frontend/
│   ├── app/
│   │   ├── page.tsx              # Trade terminal (main)
│   │   ├── markets/page.tsx      # Markets overview
│   │   ├── news/page.tsx         # News aggregator
│   │   ├── portfolio/page.tsx    # Wallet PnL tracker
│   │   ├── transfer/page.tsx     # LI.FI bridge + 1inch swaps
│   │   ├── layout.tsx            # Root layout + providers
│   │   ├── globals.css           # CSS variables + component styles
│   │   └── subpage.css           # Shared sub-page styles
│   ├── components/
│   │   ├── TradingTerminal.tsx   # Main terminal (imperative init)
│   │   ├── trade/
│   │   │   ├── TradeHeader.tsx   # Top nav bar
│   │   │   ├── OrderPanel.tsx    # Buy/Sell form
│   │   │   ├── TradesPanel.tsx   # Live trades feed
│   │   │   ├── BottomPanel.tsx   # Positions/Orders/History
│   │   │   ├── FloatingOrderBook.tsx
│   │   │   ├── XTrackerPanel.tsx # X sidebar (placeholder)
│   │   │   ├── ChartPanel.tsx    # Chart container
│   │   │   ├── TradeModals.tsx   # Close/modify modals
│   │   │   ├── orderFlow.ts     # Order logic (HL + Aster)
│   │   │   ├── marketFeed.ts    # WS feeds (both venues)
│   │   │   ├── marketList.ts    # Market dropdown + polling
│   │   │   ├── bottomTabs.ts    # Tab data loaders
│   │   │   └── asterUserStreamSync.ts
│   │   └── shared/
│   │       ├── SiteNav.tsx       # Nav for sub-pages
│   │       ├── WalletControls.tsx
│   │       └── NetworkSwitcher.tsx
│   ├── lib/
│   │   ├── trading.ts           # HL API + EIP-712 signing
│   │   ├── wallet.tsx           # WalletProvider
│   │   ├── chart.ts             # Lightweight Charts wrapper
│   │   ├── aster-agent.ts       # Aster agent approval
│   │   ├── aster-user-stream.ts # Aster user WS
│   │   ├── i18n.ts              # Translations
│   │   ├── format.ts            # Price/size formatting
│   │   ├── query.ts             # React Query helpers
│   │   └── toast.ts             # Toast notifications
│   ├── next.config.js           # Proxy rewrites to backend
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── index.ts             # Fastify entry
│   │   ├── config.ts            # Env var loader
│   │   ├── routes/
│   │   │   ├── hl.ts            # Hyperliquid proxy
│   │   │   ├── aster.ts         # Aster proxy + signing
│   │   │   ├── market-data.ts   # Binance/CoinGecko/LI.FI
│   │   │   ├── news.ts          # Aggregated news
│   │   │   ├── rss.ts           # Per-source RSS
│   │   │   ├── swap.ts          # 1inch proxy
│   │   │   └── health.ts        # Health check
│   │   ├── plugins/
│   │   │   ├── redis.ts         # Redis (graceful fallback)
│   │   │   ├── cors.ts          # CORS allowlist
│   │   │   └── rate-limit.ts    # Rate limiting
│   │   ├── ws/
│   │   │   └── relay.ts         # WebSocket relay
│   │   └── lib/
│   │       ├── cache.ts         # Redis TTL cache
│   │       ├── cached-proxy.ts  # Cached GET proxy factory
│   │       ├── fetcher.ts       # fetch + retry
│   │       ├── rss-parser.ts    # RSS/Atom parser
│   │       ├── aster-auth.ts    # Aster HMAC signing
│   │       └── agent-keystore.ts
│   ├── .env.example
│   └── package.json
│
├── ARCHITECTURE.md               # This file
└── TODO.md                       # Roadmap & priorities
```
