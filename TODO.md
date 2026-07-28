# RDO ONE — Roadmap & TODO

**Last updated:** 2026-07-28
**Stack:** Next.js 15 + React 19 + TypeScript (frontend) · Fastify + Redis + TypeScript (backend)
**Exchanges:** Hyperliquid (BASIC) · Aster DEX (EXTRA)
**Target:** Desktop only

---

## Current State

The trading terminal is functional end-to-end for both BASIC (Hyperliquid) and EXTRA (Aster) modes:

- Market order placement, close, cancel, modify
- TP/SL triggers (grouped with entry on HL, agent-signed on Aster)
- Real-time price/book/trades via WebSocket with auto-reconnect
- Live positions, balances, open orders, trade/funding/order history
- Markets overview (CoinGecko + HL perps), news aggregator (8 RSS feeds)
- Portfolio page (PnL calendar, position tracker, both venues)
- Wallet connect (MetaMask / Rabby / WalletConnect v2)

---

## Priority 1 — Infrastructure

### Redis
The backend runs without Redis (graceful degradation) but every request hits upstream APIs directly. Under load this will trigger rate limits from CoinGecko, Binance, and HL.

**Fix:** Install and run Redis locally:
```bash
brew install redis && brew services start redis
```
No code changes needed — the backend auto-detects Redis on `localhost:6379`.

### Environment variables
The following keys need to be set in `backend/.env` for full functionality:

| Key | Required for | How to get |
|---|---|---|
| `REDIS_URL` | Caching | `redis://localhost:6379` |
| `ONEINCH_API_KEY` | Token swaps on Transfer page | [portal.1inch.dev](https://portal.1inch.dev) (free) |
| `ASTER_SIGNER_ADDRESS` | EXTRA mode trading | Aster Pro API → API Wallet → Pro API tab |
| `ASTER_SIGNER_PRIVATE_KEY` | EXTRA mode trading | Same as above |
| `AGENT_KEY_ENCRYPTION_SECRET` | Per-user Aster agent keys | Any random string |

---

## Priority 2 — Features to Add

### X/Twitter Tracker
The left sidebar "X Tracker" panel is a placeholder. Needs:
- Backend route: `GET /api/x/mentions?coin=BTC` → Twitter/X API v2 search
- Env var: `X_BEARER_TOKEN` (Twitter developer account)
- Frontend: stream mentions into `#xtFeed`, update on market switch
- Alternative: use a free crypto-mentions aggregator API instead of X directly

### Chart Indicators
The TradingView Lightweight Charts widget supports overlays. Currently only OHLCV candles are rendered. Could add:
- Volume bars (already in candle data, just not rendered)
- Moving averages (SMA/EMA)
- Bollinger Bands
- RSI (separate pane)

### Notifications
No notification system exists for:
- Order fills
- TP/SL triggers hit
- Liquidation warnings
- Price alerts

Could use browser `Notification` API + optional Telegram bot webhook.

### Limit Orders
Currently only market orders are supported. Limit orders need to be added for both HL and Aster.
- HL: use `orderType: { limit: { tif: 'Gtc' } }` in the order action
- Aster: use `type: 'LIMIT'` + `timeInForce: 'GTC'` in the signed order

### Withdraw / Deposit
Partially implemented on the Transfer page. LI.FI quote/route fetching works, but the full execute flow (approval → sign → broadcast → poll status) needs completion.

### Swap
Token swap via 1inch API is wired on the backend (`/api/swap/*` with server-side API key) but the frontend swap UI on the Transfer page is not yet functional. Needs `ONEINCH_API_KEY` in backend `.env`.

### Additional Order Types (future)
- Stop-Limit
- Trailing Stop
- Scaled orders (multiple limits across a price range)
- TWAP (time-weighted average price)

---

## Priority 3 — Polish

### Loading states
Several panels show "Loading..." indefinitely when data fetch fails:
- Liq Map in bottom panel
- AI Signals section
- Markets page tables on backend timeout

**Fix:** Add timeout + fallback UI ("Failed to load — retry" button).

### Error handling
Some `catch` blocks silently swallow errors. Key places:
- `fetchHLPerps()` in Markets page — now guarded (HTTP check + array check added)
- Aster account refresh in orderFlow — catches errors but shows no UI feedback
- News page RSS fetch failures — article just doesn't appear

### Keyboard shortcuts
The market dropdown has ↑↓/Enter/Esc. Missing global shortcuts:
- `B` — Buy/Long
- `S` — Sell/Short
- `Esc` — Close any open modal/dropdown
- `1-9` — Quick size presets

### Status bar
The bottom status bar (`LIVE · timestamp`) could show:
- Connection status per WebSocket (HL ws, Aster ws)
- Current mode indicator (BASIC/EXTRA)
- Backend health (green/red dot)

---

## Priority 4 — Production Deployment

### Domain & hosting
- Frontend: Vercel or Cloudflare Pages (static Next.js export or SSR)
- Backend: Railway, Render, or VPS with PM2
- Domain: point `rdoone.com` to frontend, configure `BACKEND_URL` env var

### SSL & security
- Backend CORS: set `ALLOWED_ORIGINS` to production domain only
- Rate limiting: already in place (200 req/min per IP, configurable)
- API keys: already server-side only (1inch, Aster agent)

### Monitoring
- Backend: add `/health` checks to uptime monitor (already exists at `GET /health`)
- Frontend: add error boundary React component for crash recovery
- WebSocket: connection status visible in status bar

---

## Cleanup Done (2026-07-28)

- [x] Removed `@lifi/widget` dead dependency (LI.FI works via raw API, widget was never imported)
- [x] Fixed Markets page `fetchHLPerps` crash — added HTTP status + array validation before destructuring
- [x] Updated X Tracker placeholder — now shows API key instructions instead of "coming soon"
- [x] Fixed nav bar layout — ticker blocks moved before page links
- [x] Fixed divider heights — all nav separators now 31px
- [x] Bottom panel tabs padding increased
- [x] Live Trades column header height aligned with Market/Limit tabs
- [x] Liq Map styling matched between Trade and Markets pages

---

## Files Reference (actual structure)

```
rdo-one-setup/
├── frontend/                     ← Next.js 15 + React 19 + TypeScript
│   ├── app/
│   │   ├── page.tsx              ← Trade terminal (main page)
│   │   ├── markets/page.tsx      ← Markets overview
│   │   ├── news/page.tsx         ← Crypto news aggregator
│   │   ├── portfolio/page.tsx    ← Wallet PnL tracker
│   │   ├── transfer/page.tsx     ← LI.FI cross-chain bridge
│   │   ├── layout.tsx            ← Root layout + providers
│   │   ├── globals.css           ← Design system (CSS variables + components)
│   │   └── subpage.css           ← Shared sub-page styles
│   ├── components/
│   │   ├── TradingTerminal.tsx   ← Main terminal logic (42K lines, imperative init)
│   │   ├── trade/
│   │   │   ├── TradeHeader.tsx   ← Top nav bar
│   │   │   ├── OrderPanel.tsx    ← Buy/Sell panel (Market/Limit, TP/SL)
│   │   │   ├── TradesPanel.tsx   ← Live trades feed
│   │   │   ├── BottomPanel.tsx   ← Positions/Orders/History tabs
│   │   │   ├── FloatingOrderBook.tsx
│   │   │   ├── XTrackerPanel.tsx ← X/Twitter sidebar (placeholder)
│   │   │   ├── orderFlow.ts     ← Order placement logic (HL + Aster)
│   │   │   ├── marketFeed.ts    ← WS price/book/trades (both venues)
│   │   │   ├── marketList.ts    ← Market dropdown + switching
│   │   │   └── bottomTabs.ts    ← Tab switching + Aster data loaders
│   │   └── shared/
│   │       ├── SiteNav.tsx       ← Nav for sub-pages (Markets, News, etc.)
│   │       ├── WalletControls.tsx
│   │       └── NetworkSwitcher.tsx
│   ├── lib/
│   │   ├── trading.ts           ← HL REST API + EIP-712 signing
│   │   ├── wallet.tsx           ← WalletProvider (MetaMask/WC/Rabby)
│   │   ├── chart.ts             ← Lightweight Charts v5 wrapper
│   │   ├── aster-agent.ts       ← Aster agent approval flow
│   │   ├── aster-user-stream.ts ← Aster user WS (listenKey)
│   │   ├── i18n.ts              ← EN/RU/ZH translations
│   │   ├── format.ts            ← Price/size formatting
│   │   ├── query.ts             ← React Query cache helpers
│   │   └── toast.ts             ← Toast notifications
│   ├── next.config.js           ← Rewrites to backend (all /api/* paths)
│   └── package.json
│
├── backend/                      ← Fastify + TypeScript + Redis
│   ├── src/
│   │   ├── index.ts             ← App entry, plugin/route registration
│   │   ├── config.ts            ← Env var loader
│   │   ├── routes/
│   │   │   ├── hl.ts            ← Hyperliquid proxy (POST /hl/*)
│   │   │   ├── aster.ts         ← Aster proxy + signed endpoints
│   │   │   ├── market-data.ts   ← Binance, CoinGecko, Fear&Greed, LI.FI
│   │   │   ├── news.ts          ← Aggregated news feed
│   │   │   ├── rss.ts           ← Per-source RSS proxies
│   │   │   ├── swap.ts          ← 1inch proxy (server-side API key)
│   │   │   └── health.ts        ← GET /health
│   │   ├── plugins/
│   │   │   ├── redis.ts         ← Redis connection (graceful fallback)
│   │   │   ├── cors.ts          ← CORS whitelist
│   │   │   └── rate-limit.ts    ← 200 req/min per IP
│   │   ├── ws/
│   │   │   └── relay.ts         ← WS relay (HL + Aster fan-out)
│   │   └── lib/
│   │       ├── cache.ts         ← Redis TTL read-through cache
│   │       ├── cached-proxy.ts  ← Generic cached GET proxy factory
│   │       ├── fetcher.ts       ← fetch() with retry + timeout
│   │       ├── rss-parser.ts    ← Zero-dependency RSS/Atom parser
│   │       ├── aster-auth.ts    ← Aster HMAC-SHA256 request signing
│   │       └── agent-keystore.ts← Encrypted per-user Aster agent keys
│   ├── .env.example
│   └── package.json
│
├── TODO.md                       ← This file
├── BACKEND_SPEC.md               ← OUTDATED (describes old Vite architecture)
├── RDO_ONE_ARCHITECTURE.md       ← OUTDATED (describes old Vite architecture)
└── RDO_ONE_BACKEND_GUIDE.md      ← OUTDATED (describes old Vite architecture)
```

**Note:** The three old MD files (`BACKEND_SPEC.md`, `RDO_ONE_ARCHITECTURE.md`, `RDO_ONE_BACKEND_GUIDE.md`) describe the previous Vite + Vanilla JS architecture and are no longer accurate. This file (`TODO.md`) reflects the current Next.js + TypeScript codebase.
