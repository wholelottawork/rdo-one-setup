# RDO ONE — status handoff

**As of:** master, 2026-08-03 (was `f485fbd`, 2026-07-30)
**Verification legend:** ✅ built + unit/build verified · ⚠️ built, never run against a live/funded environment · 🔑 built, blocked on a config key · ⛔ not built

---

## Trading core

| Area | What's done | State |
|---|---|---|
| Market orders | HL: IOC limit at mark ±0.3% (HL has no native market). Aster: `type: MARKET` | ⚠️ |
| Limit orders | HL `tif: Gtc`, Aster `LIMIT/GTC` | ⚠️ |
| TP/SL on new orders | HL bundles entry+triggers atomically (`grouping: normalTpsl`); Aster places `TAKE_PROFIT_MARKET`/`STOP_MARKET` after fill | ⚠️ |
| TP/SL on existing positions | Modal price input → standalone reduce-only triggers | ⚠️ |
| TP/SL sizing | Uses `closePosition: true` — no guessed qty, correct on partial fills | ✅ |
| TP/SL on limit orders | Held by `waitForFill()` until first execution (incl. partial), so triggers can't fire on an empty position | ✅ |
| Server-side TP/SL watcher | Redis-backed, ticks every 5s, places triggers with the user's agent key. Browser watcher kept as fallback with an explicit "keep this tab open" toast | ⚠️ |
| Watcher multi-instance safety | Tick behind a Redis lock (released only if still owned) | ✅ |
| Close position | Opposite-side IOC (HL) / MARKET (Aster), reduce-only | ⚠️ |
| Cancel order | HL signed `cancel`; Aster `DELETE /fapi/v3/order` | ⚠️ |
| Modify trigger | HL native `modify`; Aster place-then-cancel (fails safe — old trigger survives a rejected replacement) | ✅ |
| Leverage | HL per-asset `updateLeverage`; Aster posts `/fapi/v3/leverage` before every entry and **aborts if refused** | ⚠️ |
| Reduce-only | Honoured on both venues | ✅ |
| HL nonces | Every signed HL action routes through `nextNonce()` — no more `Date.now()` collisions | ✅ |
| Order stats | Entry price = limit price when set, mark otherwise; slippage display real | ✅ |
| Cross Margin Ratio / Maint. Margin | Rendered for both venues | ✅ |
| Keyboard shortcuts | 1–7 interval, B/S side, A focus size, M market picker, O order book, I indicators, ? help, Esc close. View actions only — nothing submits an order, so a stray keypress can't move money. Reference lives in the ? panel | ✅ |
| Notifications | Toasts mirror to a system notification when the tab is backgrounded (outcomes only, one tag per kind so bursts replace rather than stack) | ✅ |

## Live data

| Area | What's done | State |
|---|---|---|
| Chart | Lightweight Charts v5; HL `candleSnapshot` / Aster `/fapi/klines` | ✅ |
| Order book | Floating panel, HL `l2Book` / Aster depth | ✅ |
| Live trades | HL via backend WS relay; Aster direct WS | ✅ |
| Price stream | HL `allMids` via relay, auto-reconnect + 50s keepalive | ✅ |
| Bottom tabs | Positions, Balances, Open Orders, Trade History, Funding History, Order History | ✅ |
| Chart indicators | Volume, SMA 20, EMA 50, Bollinger 20·2, RSI 14 — toggled from the chart's Indicators menu. Math in `lib/indicators.ts`, unit-tested | ✅ |
| Loading timeouts + retry | `fetchJson()` gives every market read an 8s deadline and one retry; a dead panel renders a Retry instead of an eternal "Loading…" | ✅ |
| Liq Map | Placeholder data only (synthetic gaussian weights, not real liquidation levels) | ⛔ |

## Wallet

| Area | What's done | State |
|---|---|---|
| Wallet chooser | Lists every detected injected wallet (MetaMask, Rabby, Phantom, Coinbase, unknown providers). Single option → modal skipped | ✅ |
| WalletConnect v2 | Integrated; appears in chooser when key is set | 🔑 `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` |
| Provider routing | All signing paths resolve through `getEVMProvider()` → one `activeProvider` | ✅ |
| Disconnect | Sticks (`rdo_disconnected` blocks auto-restore); kills live WC session | ✅ |
| Network switching | `NetworkSwitcher` switches chains instead of logging the user out | ✅ |

## Transfer page (5 tabs)

| Tab | What's done | State |
|---|---|---|
| Withdraw | HL end-to-end (EIP-712 → poll arrival → optional LI.FI conversion). Aster signed server-side | 🔑 Aster API creds |
| Deposit | HL → Bridge2 contract transfer (refuses <5 USDC, which the bridge swallows). Aster → signed deposit address. Other chain/token → LI.FI convert then forward **only the converted delta** | ⚠️ |
| Deposit balance + MAX | `tokenBal()` handles native (`eth_getBalance`) and ERC-20; balance only shown when wallet is on the picked chain; MAX leaves a gas reserve | ✅ |
| Send | Cross-chain via LI.FI: quote → approval → send → receipt | ✅ |
| Between accounts | HL↔Aster with full progress UI. EXTRA→BASIC leg fixed — it used to report "complete" while funds sat in the wallet | ⚠️ |
| Swap | Network, pay/receive, debounced quote, build → allowance → send → receipt. Uses curated `CHAINS` token list, not 1inch's full list | 🔑 `ONEINCH_API_KEY` |

## Security (the main work of the last two sessions)

| Item | What's done | State |
|---|---|---|
| Aster V1 secrets out of the browser | API key/secret posted once to `/aster-creds`, AES-256-GCM encrypted at rest in Redis. HMAC signing is server-side. Nothing ever returns the secret | ✅ |
| V1 route auth (withdraw / deposit-address) | Per-request wallet signature over **its own parameters** (action+user+params+timestamp), single-use via Redis `SET NX`, 5-min expiry. A stolen signature authorizes exactly one withdrawal | ✅ |
| Signed-route auth (`/aster-signed/*`, `/aster-agent-address`, `/aster-tpsl-watch`) | Wallet-signed session, HttpOnly + SameSite=Strict cookie, 12h. Tokens stored **hashed** in Redis. Every route overwrites the `user` param from the cookie. Fails closed (Redis down → 503) | ✅ |
| Session ↔ connected wallet binding | Session reused only if it belongs to the currently connected wallet; disconnect and `accountsChanged` both end it | ✅ |
| 401 retry safety | `asterFetch()` re-signs once on 401. Safe because 401 on these routes means "no session" only — Aster's own rejections come back as 200 `{code,msg}` — so no double-fill risk | ✅ |
| Message-format drift | Both sides build from `lib/authMessage.ts`, pinned by a test against the backend's bytes | ✅ |
| CORS verbs | Now allows PUT/DELETE (listenKey lifecycle, creds/session deletion). Was latent only — everything goes through Next's same-origin rewrite | ✅ |
| Set-Cookie through the Next rewrite proxy | Verified live against a stand-in backend: `Set-Cookie` survives the hop, cookie comes back on the follow-up request | ✅ |

**Cost to the user:** one extra signature per 12h. A new Aster user sees two (session, then agent approval).

## Backend

| Area | What's done | State |
|---|---|---|
| HL proxy | `POST /api/hl/*` with Redis caching | ✅ |
| Aster proxy | Market data + signed endpoints | ✅ |
| Market data | Cached proxies: Binance, CoinGecko, Fear&Greed, LI.FI | ✅ |
| Swap proxy | 1inch quote/build/tokens. `dstAmount` (v6.0 rename) handled; unchecked `data.tx` deref fixed | 🔑 `ONEINCH_API_KEY` |
| News | 8 RSS sources aggregated + image proxy | ✅ |
| WS relay | `/ws` (HL, 50s ping) and `/aster-stream` | ✅ |
| Rate limiting | 200 req/min per IP | ✅ |
| Redis | Graceful fallback via `redisOk`, except on money paths where it fails closed | ✅ |

## Sub-pages

| Page | State |
|---|---|
| Markets — CoinGecko trending + HL perps meta | ✅ |
| News — 8 RSS feeds | ✅ |
| Portfolio — PnL calendar + position tracker, both venues | ✅ |

---

## What's actually left

| # | Item | Type | Blocker |
|---|---|---|---|
| 1 | `ONEINCH_API_KEY` in `backend/.env` | Config | Free key at portal.1inch.dev → Swap goes live |
| 2 | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Config | Free at cloud.walletconnect.com → mobile wallets work |
| 3 | `ASTER_SIGNER_ADDRESS` / `ASTER_SIGNER_PRIVATE_KEY` | Config | Aster Pro API dashboard → EXTRA mode |
| 4 | ~~Run Redis~~ | ~~Environment~~ | **Resolved.** Built 7.2.5 from source into WSL `~/redis-src` (no sudo needed — `apt` was the blocker, not the build), bound to 127.0.0.1:6379, `dir ~/redis-data`. Reachable from Windows via WSL localhost forwarding, which is the backend's default `redis://localhost:6379`. Backend logs "Redis connected"; verified a real round trip (HL meta proxy 460ms cold → 31ms warm, cache key present in Redis, rate limiter keying off it too). **Restart after a WSL shutdown:** `wsl -d Ubuntu -e ~/redis-src/redis-7.2.5/src/redis-server --port 6379 --daemonize yes --dir ~/redis-data --logfile ~/redis-data/redis.log --bind 127.0.0.1` |
| 5 | Exercise money paths live | Verification | Needs funded wallet + Aster creds. Redis is no longer a blocker here (#4). **Deposit, withdraw, swap and the server-side TP/SL watcher have still never made a real call** |
| 6 | Git author identity on the Mac mini | Housekeeping | `git config --global user.name/email`; history rewrite still undecided |

**Code backlog is clear.** Everything above the line is written; #1, #2, #3, #5 and #6 are config, live verification, or housekeeping — #4 is done.

### Deliberate ceilings (marked `ponytail:` in code)
- Browser fallback TP/SL watcher still dies with the tab (only runs when the backend watcher is unreachable, and says so).
- Swap uses the curated `CHAINS` token list, not 1inch's full one (thousands per chain, would need a searchable picker).
- Liq Map renders placeholder data. Real liquidation levels need a paid data source — neither HL nor Aster exposes them.
- Notifications use the browser's own permission prompt, with no in-app opt-in or re-enable UI.

### Nice-to-have, not started
X/Twitter tracker (needs an API key) · advanced order types (stop-limit, trailing, scaled, TWAP).

Advanced order types are code-only but deliberately deferred: they are money-path
logic, and #5 means the existing order paths have not yet been exercised against
real funds. Adding more unverified order logic on top only grows that surface.

Two earlier entries on this list turned out not to need building:
- **Status bar** was already built and wired — `#wsDot`/`#wsStatus` track the HL
  price socket's open/close and `startClock()` ticks the UTC clock. It only
  reflects the HL stream, not Aster's, which is the one gap left in it.
- **Swap's full token list** stays deliberately curated. `CHAINS` feeds the
  withdraw, deposit, send *and* swap pickers, so widening it touches three money
  paths at once, and swap itself can't be exercised without `ONEINCH_API_KEY`
  (#1). Worth doing as its own change, with a searchable picker, once #1 and #5
  are cleared.

---

## How to verify locally

```
npm test        # frontend: orderMath, authMessage, indicators
                # backend:  wallet-auth, aster-session
tsc --noEmit    # both packages
next build      # frontend
```
All clean. The Redis round trip (#4) is verified live against the running
backend. Everything else this session is build + unit level: the indicator
math is unit-tested, but the menu, shortcuts and notification mirroring have
not been clicked in a real browser — there's no browser in the dev environment.
Money paths remain untouched by real funds (#5).
