# RDO ONE — current-state handoff

**As of:** 2026-08-09 · `master` at `f6592ca`, plus the large **uncommitted working tree** described below

**Read this first:** almost all production-readiness and Aster V3 work currently exists only as modified/untracked files on top of `f6592ca`. It is not part of the committed `master` history yet. Review and commit it before treating any deployment as reproducible.

**Status legend:** ✅ code + automated verification complete · 🧪 exercised against a live upstream, but not as a complete funded app flow · ⚠️ built but still needs deployed/funded verification · 🔑 code exists but a key/config value is required · ⛔ not built

The source-of-truth order used for this handoff is: current code and tests, then `todo/*-RESULT.md`, then the task briefs, then `end_plan.md`. The plan and several task briefs describe the state before implementation and are intentionally not treated as current status.

---

## Executive state

The product surface is substantially built: dual-venue trading, live data, wallet selection, five transfer tabs, sub-pages, and the security model all exist. The production-readiness pass has also implemented the high-priority Redis, reverse-proxy, WebSocket, deployment, logging, Aster V3 withdraw/deposit, and V1-removal work.

The project is **not beta-cleared yet**. The remaining risk is operational and live-money verification rather than a large missing code feature:

- the current changes are uncommitted;
- no funded end-to-end checklist has been recorded for the deployed application;
- Aster withdrawal does not work in MetaMask because Aster requires a chain-1666 EIP-712 domain but exposes no usable EVM RPC for that chain;
- production deployment, uptime-monitor setup, and off-box secret/backup handling still require operator work;
- CI and the broader documentation cleanup have not been built;
- the Liq Map is illustrative/synthetic and is not visibly labelled as such.

Aster V1 credentials are no longer part of the runtime design. New users cannot obtain them, and the old Binance-shaped withdraw/deposit-address endpoints were invalid for Aster. Withdraw now uses two user-wallet signatures; deposit now calls Aster's EVM vault contract.

---

## Verification snapshot

Re-run on 2026-08-09 against the current working tree:

| Check                     | Result                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend tests            | ✅ 5 scripts pass: order math, auth message, Aster withdraw, Aster deposit, indicators                                                              |
| Backend tests             | ✅ 6 scripts pass: wallet auth, session, Aster withdraw verifier, Redis health, log scrubber, WS relay                                              |
| Backend TypeScript        | ✅ `tsc --noEmit`                                                                                                                                   |
| Frontend TypeScript       | ✅ `tsc --noEmit`                                                                                                                                   |
| Frontend production build | ✅ builds with `NEXT_PUBLIC_HL_WS_URL=wss://example.com/ws`; 8 static pages generated                                                               |
| Local Compose definition  | ✅ `docker compose ... config` validates with `.env.local` inputs                                                                                   |
| Production Compose/deploy | ⚠️ the production definition and runbook exist, but this checkout has no root `.env`; full TLS/deploy/post-deploy verification is not recorded here |
| Browser/funded flows      | ⚠️ no complete deployed money-path checklist exists                                                                                                 |

Task 12 records additional local runtime checks: Redis down/up health transitions, watcher stall/recovery, log redaction, pending-watch health data, log rotation, and backup verification paths. Those are valuable local checks, not a substitute for the deployed/funded checklist.

---

## Production-readiness task ledger

| Task                       | Current state                       | Important qualification                                                                                                                                                                                                                                          |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01 · Aster signer spike    | 🧪 Done                             | Option 1 works: the user's wallet signs both signatures and `signer` is omitted. Confirmed on Aster mainnet with a real 0.001 BNB withdrawal. Option 2 (`canWithdraw:false` agent) was rejected.                                                                 |
| 02 · Backend runtime fixes | ✅ Done                             | Live Redis state, fail-closed 503 handling, `trustProxy`, production `tsx`, graceful shutdown, Redis-aware `/health`, and tests are present.                                                                                                                     |
| 03 · Frontend env/build    | ✅ Done                             | Production build rejects missing/loopback `NEXT_PUBLIC_HL_WS_URL`; standalone output and env examples exist.                                                                                                                                                     |
| 04 · WS relay              | ✅ Done                             | Empty subscriptions unsubscribe upstream, messages route per topic with a safe broadcast fallback, per-IP/per-connection limits exist, and relay tests pass. Relay access remains unauthenticated by design.                                                     |
| 05 · Config/secrets        | ✅ Done in code                     | `AGENT_KEY_ENCRYPTION_SECRET` is correctly the EXTRA-mode blocker; `ASTER_SIGNER_PRIVATE_KEY` only gates leverage caps; `ASTER_SIGNER_ADDRESS` is gone. Some example-env prose still mentions deleted V1 credentials.                                            |
| 06 · LI.FI API key         | ✅ Done                             | Optional `LIFI_API_KEY` sends `x-lifi-api-key`; optional `LIFI_INTEGRATOR` is forced onto every call as `integrator` so the browser cannot spoof or drop the attribution. Quote caching intentionally keeps the full amount and wallet addresses to avoid serving another wallet's calldata. |
| 07 · Aster V3 withdraw     | ⚠️ Built                            | Frontend creates both signatures; backend verifies both and forwards byte-for-byte. Tests pin domains/field order/tampering. An unfunded live request reached Aster's balance check. Payout chain follows the destination across Aster's supported set (Ethereum/BNB Chain/Arbitrum), falling back to Arbitrum + LI.FI otherwise. The withdraw tab now reads the Aster balance and warns MetaMask users up front. The complete funded app flow remains task 13, and MetaMask is still incompatible. |
| 08 · Aster V3 deposit      | ⚠️ Built                            | Uses `approve` + `depositFor(..., broker=0)` and preserves delta-only forwarding. Unit-tested, not verified with a real futures-account credit.                                                                                                                  |
| 09 · Remove Aster V1       | ✅ Runtime removal; cleanup remains | Credential storage/routes/card and deposit-address flow are gone. Dead Next rewrites for `/aster-creds` and `/aster-deposit-address`, plus stale V1 wording in env examples, still need deletion.                                                                |
| 10 · Docker Compose deploy | ⚠️ Built, not production-proven     | Five services: nginx, Next, Fastify, Redis, certbot. Includes TLS bootstrap/renewal, healthchecks, persistent AOF Redis, log rotation, non-root images, deploy/rollback scripts, and a local stack. Run it on the real VPS and complete the runbook.             |
| 11 · Observability         | ✅ Code; operator setup remains     | Chosen design is pino/Docker logs, not Sentry. Money audit events, shape-based secret scrubbing, watcher health/stall data, and backup verification exist. External uptime/keyword monitors still need an account and alert destination.                         |

---

## Product state

### Trading core

| Area                          | Current implementation                                                                                                                                          | State                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| Market / limit orders         | HL uses IOC-at-mark ±0.3% / GTC; Aster uses MARKET / LIMIT-GTC                                                                                                  | ⚠️                            |
| TP/SL on new orders           | HL atomic `normalTpsl`; Aster places `TAKE_PROFIT_MARKET` / `STOP_MARKET` after fill                                                                            | ⚠️                            |
| TP/SL on resting Aster limits | Redis-backed watcher ticks every 5s; browser watcher is the explicit fallback when registration fails                                                           | ⚠️ funded fill still untested |
| Watcher safety                | Redis ownership lock, 30-minute expiry, live health/stall counters, and negative Aster `{code}` responses treated as failures rather than successful placements | ✅ automated/local            |
| TP/SL sizing                  | `closePosition:true`, so partial fills do not depend on guessed quantity                                                                                        | ✅ code/tests                 |
| Close / cancel                | Opposite reduce-only IOC/MARKET; HL signed cancel; Aster V3 DELETE                                                                                              | ⚠️                            |
| Modify trigger                | HL native modify; Aster place-then-cancel so a rejected replacement leaves the old protection alive                                                             | ✅ code/tests                 |
| Leverage                      | HL per-asset update; Aster posts V3 leverage before an entry and aborts if refused                                                                              | ⚠️                            |
| Nonces / order stats          | HL actions share `nextNonce()`; limit stats use limit price; slippage display is real                                                                           | ✅                            |
| UI safety/features            | Cross/maintenance margin, keyboard shortcuts, and background system notifications are built                                                                     | ✅ build/unit level           |

### Live data and pages

| Area                                                          | State                                                                                                                                                        |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Chart, candles, order book, trades, HL price stream           | ✅ built; WS relay reconnect/keepalive present                                                                                                               |
| Positions, balances, open orders, trade/funding/order history | ✅ built for both venues                                                                                                                                     |
| Indicators                                                    | ✅ Volume, SMA 20, EMA 50, Bollinger 20·2, RSI 14; math unit-tested                                                                                          |
| Read deadlines/retry UI                                       | ✅ 8s deadline, one retry, explicit Retry instead of permanent loading                                                                                       |
| Markets / News / Portfolio                                    | ✅ built                                                                                                                                                     |
| Liq Map / OI / AI panels                                      | ⚠️ depend on Binance futures through the VPS; Liq Map weights are synthetic, not real liquidation levels, and no visible "illustrative" label has been added |

The direct `/fapi/*` Next rewrite remains the only upstream path outside the Fastify cache/rate limiter. It also makes VPS region load-bearing: Binance returns 451 from the US, Malaysia, and Ontario. Use an allowed region and run the runbook's region check.

### Wallet

| Area                          | State                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| Injected-wallet chooser       | ✅ MetaMask, Rabby, Phantom, Coinbase, unknown injected providers                                        |
| WalletConnect v2              | 🔑 Built; hidden until `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is supplied at build time                  |
| Provider routing / disconnect | ✅ one active EIP-1193 provider; explicit disconnect blocks auto-restore and ends WalletConnect sessions |
| Network switching             | ✅ switches chains without logging the user out                                                          |

### Transfer page (five tabs)

| Tab/path               | Current implementation                                                                                                                                   | State                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Withdraw · Hyperliquid | EIP-712 withdrawal, arrival polling, optional LI.FI conversion                                                                                           | ⚠️ funded app flow not recorded                  |
| Withdraw · Aster       | Public fee quote; `Action` signature on destination chain plus V3 auth signature on domain chain 1666; backend verifies both and holds no withdrawal key | 🧪 signatures/upstream shape; ⚠️ funded app flow |
| Deposit · Hyperliquid  | Bridge2 transfer; refuses deposits below 5 USDC                                                                                                          | ⚠️                                               |
| Deposit · Aster        | ERC-20 approval then Aster vault `depositFor`, broker `0` for futures                                                                                    | ⚠️ unit-tested, no live credit recorded          |
| Deposit balance / MAX  | Native and ERC-20 balance handling; only shows the selected chain; native MAX reserves gas                                                               | ✅                                               |
| Send                   | LI.FI quote → approval → transaction → receipt                                                                                                           | ⚠️                                               |
| Between accounts       | HL↔Aster progress flow; Aster-bound leg ends in `depositFor`; converted-delta forwarding preserved                                                       | ⚠️                                               |
| Swap                   | LI.FI same-chain quote (`fromChain === toChain`) → chain switch → allowance → send → receipt, using the curated token list                                | ⚠️ live verification                             |

#### Aster withdrawal wallet caveat

Aster accepts the user's wallet as the V3 signer only with EIP-712 domain chain ID **1666**. MetaMask refuses to sign a domain whose chain differs from the connected chain, and Aster exposes no usable EVM RPC to add/switch to chain 1666. Rabby and most mobile wallets over WalletConnect sign the payload; MetaMask does not. The UI now warns as soon as Aster is picked as the withdrawal source (`walletBlocksAsterAuth`, which requires `isMetaMask` and not `isRabby`/`isCoinbaseWallet`, since Rabby also sets `isMetaMask`), and still explains the refusal if it happens anyway.

Do not solve this by giving an agent withdrawal permission without a deliberate security decision. The spike proved `canWithdraw:false` cannot sign withdrawals, and Aster agents cannot be amended or revoked through the API; they must be removed on Aster's API-wallet page. Current per-user agents remain trade-only (`canWithdraw:false`).

---

## Security and backend state

| Area                           | Current state                                                                                                                                        | State                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Aster V1 secrets               | Runtime credential store, HMAC signer, routes, and UI card deleted. No migration was needed because there were no users/stored credentials           | ✅ with stale rewrite/comment cleanup noted above |
| Aster trading sessions         | Wallet-signed, 12h HttpOnly + SameSite=Strict cookie; token stored hashed in Redis; route user comes from the session; Redis failure closes with 503 | ✅                                                |
| Session-wallet binding         | Session reused only for the connected wallet; disconnect and account change end it                                                                   | ✅                                                |
| Aster withdrawal authorization | Server recovers both user signatures and verifies signed destination/amount/fee before forwarding; server holds no withdrawal capability; EOA only   | ✅ code/tests                                     |
| Agent keys                     | Per-user trade-only key encrypted AES-256-GCM in Redis; `AGENT_KEY_ENCRYPTION_SECRET` must remain stable and backed up off-box                       | ✅ / 🔑 deployment secret                         |
| Wallet replay guard            | Single-use Redis `SET NX`, five-minute request-signature expiry, Redis exceptions become 503                                                         | ✅                                                |
| Logging secrecy                | Request URLs/bodies on sensitive routes are dropped or scrubbed; 64-hex and 65-byte signature shapes are redacted even inside messages               | ✅ tests/local checks                             |
| CORS / proxy                   | PUT/DELETE allowed; nginx overwrites `X-Forwarded-For`; Fastify trusts that proxy                                                                    | ✅ config/code                                    |
| Rate limits                    | HTTP 200/min/IP by default; WS 25 connections/IP and 100 subscriptions/connection per relay                                                          | ✅                                                |
| Redis                          | Live readiness, reconnect recovery, fail-closed money paths; named volume + AOF every second; internal-only and password-protected in Compose        | ✅ code/config; ⚠️ production proof               |
| Health                         | Redis-aware HTTP status plus pending/oldest TP/SL watches and watcher stall/error counters                                                           | ✅                                                |
| Shutdown                       | SIGTERM/SIGINT close Fastify, Redis, and watcher resources; Compose grants 45s                                                                       | ✅                                                |
| Observability                  | Structured pino logs, 10MB × 3 rotation per service, `audit:money` events, watcher transitions, restore/decrypt test script                          | ✅ local; ⚠️ monitor/off-box setup                |

The production logging choice is deliberately **no external error tracker**. Consequences: no frontend exception alerting, aggregation, or retention beyond the last 30MB per service. The uptime monitors are therefore mandatory operational coverage, not a nice-to-have.

---

## Deployment and configuration truth

This checkout has `.env.local` but no production root `.env`. Do not infer that any production key is configured from the presence of example files.

| Variable                               | Requirement and actual purpose                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DOMAIN`, `CERTBOT_EMAIL`              | Required for the VPS/nginx/TLS deployment                                                                                                                    |
| `REDIS_PASSWORD`                       | Required by production and local Compose; Redis is internal-only but still authenticated                                                                     |
| `AGENT_KEY_ENCRYPTION_SECRET`          | **Required for EXTRA mode.** Generate once before the first user and keep an off-box copy. Rotating/loss forces every user to approve a new trade-only agent |
| `NEXT_PUBLIC_HL_WS_URL`                | **Required at frontend build time.** Production build rejects missing or loopback values                                                                     |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional build-time key; enables WalletConnect/mobile wallets                                                                                                |
| `LIFI_API_KEY`                         | Optional but strongly recommended for beta; raises the shared VPS quote limit from 75/2h to 100/min. Both Send and Swap spend that quota now                 |
| `LIFI_INTEGRATOR`                      | Optional, not a secret. Partner Portal integration string that owns the key; without it LI.FI traffic is unattributed and Portal analytics stay empty        |
| `ASTER_SIGNER_PRIVATE_KEY`             | Optional; only fetches real per-symbol leverage caps. Trading otherwise uses each user's agent                                                               |
| `ALLOWED_ORIGINS`                      | Derived from `DOMAIN` by production Compose; defence in depth because browser traffic normally passes through Next                                           |
| `LOG_REQUEST_BODIES`                   | Keep `false`; sensitive route bodies are never logged even when enabled                                                                                      |

There is no `ASTER_SIGNER_ADDRESS`, no Aster V1 API key/secret, and no implemented `X_BEARER_TOKEN` backend feature. The X panel's string mentioning that token is a placeholder, not configuration documentation.

---

## What is actually left before private beta

1. **Review and commit the current working tree.** It contains the implementation for tasks 01–10 and 12, Docker/deploy files, tests, and this handoff. Until committed, `master` at `f6592ca` does not contain them.
2. **Decide supported-wallet policy for Aster withdrawal.** Either explicitly exclude MetaMask for that one action and steer users to Rabby/WalletConnect, or wait for Aster to publish a real chain-1666 RPC/API fix. Do not grant withdrawal-capable agents casually.
3. **Provision and deploy the real stack.** Use a VPS outside the US/Malaysia/Ontario, create `.env`, back it up off-box, issue TLS, deploy, and run every post-deploy check in `deploy/RUNBOOK.md`. Decide whether the beta is merely unadvertised or actually protected with nginx Basic auth; the config is open by default and TLS certificates expose the hostname publicly.
4. **Create the two uptime monitors.** One alerts on non-2xx `/health`; one alerts when the body contains `"tpslWatcherStalled":true`. Point them at an alert channel someone reads.
5. **Run and record task 13 on the deployed stack with minimum funds.** In order: HL reads; HL market/limit/cancel/close; HL TP/SL; Aster session/agent through nginx; Aster market/limit; server-side Aster TP/SL with the browser closed; HL and Aster deposits; HL and Aster withdrawals; swap; Between Accounts both ways. Verify venue state, not only UI toasts. Add the results as a checked-in checklist.
6. **Add CI.** On push: frontend/backend tests, both typechecks, frontend production build with a safe WS value, and both Docker builds. No workflow exists today.
7. **Finish documentation/cleanup.** Remove the two dead Next rewrites and stale V1 env wording; reconcile `ARCHITECTURE.md` and `BACKEND_SPEC.md`; archive the three legacy `RDO_ONE_*` documents; replace or remove stale root `TODO.md`; add a real root `README.md`; fix the stale wallet-auth comment identified in `end_plan.md`.
8. **Make the Liq Map honest in the UI.** Add a visible “illustrative, not real liquidation data” label. Real levels require a paid data source.
9. **Complete backup operations.** The scripts work locally, but `backup-redis.sh` writes beside the deployment. Copy dumps off the VPS and re-run `verify-backup.sh` after the first real agent exists so decryption can be proven rather than partially checked.

Do not add stop-limit, trailing, scaled, or TWAP orders until the funded checklist is green. They expand the same unverified money-path surface.

---

## Deliberate ceilings and public-launch backlog

- Browser TP/SL watching remains only as a fallback when the backend watcher cannot register; that fallback dies with the tab and tells the user to keep it open.
- Transfer and Swap use the curated `CHAINS` token list. A full list needs a searchable picker and touches several money paths at once.
- Liq Map uses synthetic weights. Real liquidation data is a paid-data problem.
- Notifications rely on the browser permission prompt; there is no in-app notification settings UI.
- The WS relay is bounded but unauthenticated and stores subscriptions in-process; horizontal scaling requires shared/routed relay state.
- Redis is a deliberate single point of failure for money paths and fails closed. HA/managed Redis is a public-launch decision.
- Public launch still needs per-wallet rate limits, load testing, legal/terms and jurisdiction review, cost review, and the deferred git-history rewrite.
- X/Twitter tracking remains a paid-API placeholder.

---

## Commands and operator references

```bash
npm test
npm --prefix backend run typecheck
cd frontend && npx tsc --noEmit
NEXT_PUBLIC_HL_WS_URL=wss://example.com/ws npm run build
```

Production operations and the exact health/Redis/WS/TLS/backup checks live in `deploy/RUNBOOK.md`. The detailed reasoning and historical task acceptance criteria remain in `end_plan.md` and `todo/`; use this file for current status.
