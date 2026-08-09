# RDO ONE — deployment runbook

One VPS, five containers on an internal Compose network:

```
internet → nginx (80/443) ─┬→ frontend (Next standalone, :3002)
                           └→ backend  (Fastify, :3001)
                                  └→ redis (:6379, internal only)
        certbot (renewal loop, no ports)
```

---

## Before you provision the VPS: region

**Do not use a US, Malaysian or Ontario region.**

`frontend/next.config.js` rewrites `/fapi/*` directly to `fapi.binance.com`, and Next
proxies external rewrites **server-side** — the request leaves from the VPS, not from the
user's browser. Binance answers HTTP 451 to those regions, which kills the Liq Map, OI Flow
and AI Signals panels for **every** user regardless of where they are. Hetzner EU is fine.

Check it from the box before deploying anything:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://fapi.binance.com/fapi/v1/time
# 200 = good.  451 = wrong region, rebuild the VPS elsewhere.
```

Requirements: Docker Engine with the Compose plugin, ports 80 and 443 open, and DNS A
records for both `$DOMAIN` and `www.$DOMAIN` already pointing at the box.

---

## First deploy

```bash
git clone <repo> && cd rdo-one-setup

cp .env.example .env
openssl rand -hex 32     # → REDIS_PASSWORD
openssl rand -hex 32     # → AGENT_KEY_ENCRYPTION_SECRET
$EDITOR .env             # fill in DOMAIN, CERTBOT_EMAIL, NEXT_PUBLIC_HL_WS_URL, the rest

./deploy/init-letsencrypt.sh    # ONCE — issues the TLS certificate
./deploy/deploy.sh              # build, start, health-gate
```

### Back up `.env` right now, off the box

This is the single most important step on this page.

`AGENT_KEY_ENCRYPTION_SECRET` decrypts every user's stored Aster agent key. A Redis backup
without it is unrecoverable ciphertext — the data is there and nothing can read it. Losing
the secret means every EXTRA-mode user re-approves an agent.

Put `.env` in a password manager. It is a few hundred bytes. Do not keep the only copy on
the machine it protects.

---

## Routine operations

```bash
./deploy/deploy.sh            # pull, build, start, wait for health
./deploy/deploy.sh --no-pull  # build the working tree as-is
./deploy/deploy.sh rollback   # back to the previous healthy tag
./deploy/deploy.sh status     # what is running, and the deploy history
./deploy/deploy.sh logs backend
./deploy/deploy.sh stop       # stop containers, data untouched
./deploy/backup-redis.sh      # optional snapshot (writes to ./backups — copy it OFF the box)
./deploy/verify-backup.sh     # prove the newest dump restores AND decrypts
```

Images are tagged with the short git SHA, which is what makes rollback mean anything —
`latest` alone is not a rollback story.

### Changing a `NEXT_PUBLIC_*` value needs a REBUILD, not a restart

`NEXT_PUBLIC_HL_WS_URL` and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` are inlined into the
browser bundle by `next build`. Editing `.env` and restarting changes nothing — the bundle
keeps whatever it was built with. Run `./deploy/deploy.sh` (which rebuilds).

Every other value in `.env` is genuine runtime config: `docker compose up -d` is enough.

---

## The one command never to run

```
docker compose down -v      #  ← DO NOT
```

`-v` deletes the `redis_data` volume. That is every user's encrypted Aster agent key
(`aster:agent-key:*`, written with **no expiry**) and every pending TP/SL watch. It is by
far the most likely way this data actually gets lost, and there is no undo.

Use `./deploy/deploy.sh stop` — it stops containers and leaves volumes alone. Plain
`docker compose down` is also safe; it is only `-v` that destroys data.

| Key | Cost of losing it |
|---|---|
| `aster:agent-key:*` (no expiry) | Every EXTRA user re-approves an agent, one signature each |
| `aster:tpsl-watch` | Silent loss of protection on resting limit orders. Bounded: 30-min max age |
| `sess:*` | Users re-sign. 12h TTL anyway |
| cache keys | Nothing |

Funds are never at risk: agents are registered `canWithdraw: false`.

### Restoring a backup is not automatically correct

A restored dump re-arms `aster:tpsl-watch` entries whose orders have long since filled or
been cancelled, against positions that may not exist. After restoring a stale dump:

```bash
docker compose exec redis redis-cli DEL aster:tpsl-watch
```

Agent keys age fine. Sessions expire on their own.

---

## TLS

`init-letsencrypt.sh` handles first issuance only. After that the `certbot` container
attempts renewal every 12h, and nginx reloads every 6h to pick up a renewed certificate.
Nothing to do manually.

Use `./deploy/init-letsencrypt.sh --staging` first if DNS is at all in doubt — Let's Encrypt
rate-limits *failed* issuance hard (5 per hostname per hour), and burning that quota means
waiting.

### The beta is currently OPEN

Anyone who learns the hostname can reach the app. If the intent is "invited people only",
not publishing the URL does **not** achieve that: every certificate certbot issues appears
in public Certificate Transparency logs within minutes and is searchable at crt.sh.

To actually gate it:

```bash
htpasswd -Bc deploy/nginx/htpasswd someuser
```

mount that file into the nginx service, and uncomment the two `auth_basic` lines in
`deploy/nginx/templates/default.conf.template`. At server level they cover everything,
including `/ws` and `/aster-stream`.

---

## Verification after a deploy

```bash
# 1. all healthy
./deploy/deploy.sh status

# 2. TLS, HSTS, redirect
curl -I https://$DOMAIN
curl -I http://$DOMAIN            # → 301

# 3. Redis outage behaviour — the most valuable check here
docker compose stop redis
curl -s -o /dev/null -w '%{http_code}\n' https://$DOMAIN/health    # → 503, NOT 500 and NOT 200
curl -I https://$DOMAIN                                            # site still serves
docker compose start redis
curl -s https://$DOMAIN/health                                     # → 200, backend never restarted

# 4. data survives a full stop/start
docker compose down && docker compose up -d
docker compose exec redis redis-cli KEYS 'aster:agent-key:*'       # → still there

# 5. region check
curl -s -o /dev/null -w '%{http_code}\n' https://fapi.binance.com/fapi/v1/time   # → 200

# 6. observability — see § Observability for what each field means
curl -s https://$DOMAIN/health | jq '{redis, pendingTpslWatches, tpslWatcherStalled}'
docker compose logs backend | head -5          # boot lines name the release
docker inspect --format '{{.HostConfig.LogConfig.Config}}' $(docker compose ps -q backend)
                                               # → map[max-file:3 max-size:10m], i.e. rotation is on

# 7. the money trail exists at all (after any real trade)
docker compose logs backend | grep '"audit":"money"' | tail
```

A fake pending TP/SL watch is the cheapest way to confirm `/health` is really reading Redis
rather than reporting a constant — it also exercises the `oldestPendingTpslWatchMs` path:

```bash
docker compose exec redis redis-cli HSET aster:tpsl-watch 'verify:1' \
  '{"user":"0x0000000000000000000000000000000000000001","symbol":"BTCUSDT","orderId":"1","side":"SELL","slPrice":"1","createdAt":0}'
curl -s https://$DOMAIN/health | jq '{pendingTpslWatches, oldestPendingTpslWatchMs}'   # → 1, a large number
docker compose exec redis redis-cli HDEL aster:tpsl-watch 'verify:1'                   # CLEAN UP
```

`createdAt:0` is deliberate on two counts. It makes the row older than the 30-minute max age,
so the watcher expires it on its next pass and logs `tpsl.expired` — which is itself proof
the watcher is running — and it means the watcher never calls Aster for this fake user, so no
agent key is minted for an address that does not exist.

The flip side is a race: the pass runs every 5s, so run the `curl` immediately or it will
already read 0. Either result is informative — `pendingTpslWatches: 1` proves `/health` reads
Redis, and a `tpsl.expired` line in the log proves the watcher does. Run the `HDEL` regardless;
never leave test rows in a hash that drives real protections.

In the browser: confirm the price stream connects and that the WebSocket URL in DevTools is
the real host, **not** `localhost`. A `localhost` URL means the image was built without
`NEXT_PUBLIC_HL_WS_URL` — the chart will never tick and nothing in the UI says why.

---

## Observability

There is no error-tracking service, no agent and no dashboard. Everything the backend knows
goes to **stdout as pino JSON**, Docker captures it, and `docker compose logs` is the tool.
Read this section before the first real withdrawal, not after.

### What retention actually is

10MB × 3 files per service (`x-logging` in `docker-compose.yml`). Nothing ships off the box.
**Anything older than the last 30MB is gone** — so log volume is a correctness concern, not
tidiness: a noisy failure can push the evidence of its own cause out of the window.

Two things keep that from happening, and both are load-bearing:

- production runs at level **`warn`**, so routine request noise never reaches the log;
- repeated identical Redis connection errors are throttled to one line a minute
  (`backend/src/plugins/redis.ts`) — untuned, a Redis outage writes ~40k identical lines a
  day and erases everything else within two days.

If you add logging, keep both properties. `info` on a per-request path is not free here.

### The money trail

Production logs at `warn`, which would make every successful withdrawal, order and stop-loss
invisible. They are not: the fund-moving paths log through a child logger pinned to `info`
(`backend/src/lib/money-log.ts`) and are tagged **`"audit":"money"`**.

```bash
# every fund-moving event
docker compose logs backend | grep '"audit":"money"'

# just withdrawals
docker compose logs backend | grep '"event":"withdraw'

# protections that were promised but never placed — the one to check first
docker compose logs backend | grep '"event":"tpsl.failed"'
```

| Event | Means |
|---|---|
| `withdraw.forwarded` | verified locally, sent to Aster (user, asset, amount, fee, chain, receiver) |
| `withdraw.result` | what Aster answered. `warn` if it rejected |
| `withdraw.rejected` | failed our own signature check — never left the box |
| `order.placed` / `order.rejected` | signed order passthrough, and Aster's verdict |
| `tpsl.armed` | a resting limit order's TP/SL was registered with the watcher |
| `tpsl.placed` | triggers actually placed after the fill |
| `tpsl.failed` | **the position is open and at least one protection is missing** |
| `tpsl.expired` | the limit never filled within 30 min; no protection was needed |

`tpsl.armed` without a matching `tpsl.placed` or `tpsl.expired` is an unresolved obligation.

### What is deliberately NOT logged

Request **bodies** on `/aster-withdraw`, `/aster-session`, `/aster-signed/*` and
`/aster-approve-agent`. Those bodies are the credential itself — `/aster-withdraw` carries
two EIP-712 signatures that **together are a withdrawal anyone reading the log can replay**
until the nonce ages out.

`LOG_REQUEST_BODIES=true` turns on body logging for debugging. Even then those routes are
dropped, not redacted, and the backend logs a warning at boot so it cannot be left on
unnoticed. Turn it off when you are done.

Beyond that, every log line goes through `backend/src/lib/scrub.ts`, which redacts by
**shape** as well as by field name: any 64-hex value (private key, session id, encryption
secret) or 65-byte signature is replaced with `[redacted]` wherever it appears, including
inside an error message or a URL. `req.url` is scrubbed for exactly this reason — on
`/aster-signed/*` the URL *is* the whole signed request.

To convince yourself rather than take this on trust:

```bash
# Trigger a rejection on the money route with a junk signature.
SIG=0x$(printf 'a1%.0s' {1..65})
curl -s -X POST https://$DOMAIN/aster-withdraw -H 'Content-Type: application/json' \
  -d "{\"query\":\"chainId=56&asset=USDT&amount=5&fee=0.1&receiver=0x1111111111111111111111111111111111111111&userNonce=1&user=0x2222222222222222222222222222222222222222&nonce=$(date +%s000000)&userSignature=$SIG\",\"signature\":\"$SIG\"}"

# The signature must appear NOWHERE in the log. No output = pass.
docker compose logs backend --since 2m | grep -i "${SIG#0x}"
```

### Uptime monitoring

Free tier, UptimeRobot or healthchecks.io, against `https://$DOMAIN/health`. Two monitors,
because they catch different failures:

**1. Status monitor — "is the backend able to serve a trade?"**

| | |
|---|---|
| URL | `https://$DOMAIN/health` |
| Type | HTTP(s) |
| Interval | 5 min (free-tier minimum) |
| Alerts on | any non-2xx |

`/health` returns **503** when Redis is down, so this is not a liveness ping: Redis down
means sessions, the signed-route replay guard and the TP/SL watcher are all out.

**2. Keyword monitor — "are user protections still being placed?"**

| | |
|---|---|
| URL | `https://$DOMAIN/health` |
| Type | HTTP(s) keyword |
| Keyword | `"tpslWatcherStalled":true` |
| Alert when | keyword **exists** |

This is the highest-consequence silent failure in the app, and the reason the field is a
flat, literally-spelled boolean: a free keyword monitor has no JSON support.

**Point the alerts somewhere you actually read.** An alert nobody sees is worse than no
alert — it manufactures the feeling of coverage. A phone push or a Telegram bot beats email.

### The TP/SL watcher, and why it gets its own monitor

`backend/src/lib/aster-tpsl-watcher.ts` is the one background job holding user money open:
it places stop-losses for resting limit orders *after* they fill. If it stops working,
nothing throws, no request 500s, the UI looks correct, and stop-losses simply never appear.

`/health` reports it:

```bash
curl -s https://$DOMAIN/health | jq '{pendingTpslWatches, oldestPendingTpslWatchMs, tpslWatcherStalled, tpslWatcher}'
```

| Field | Read it as |
|---|---|
| `pendingTpslWatches` | protections promised, not yet placed |
| `oldestPendingTpslWatchMs` | approaching 1,800,000 (30 min) = fills are not being noticed |
| `tpslWatcherStalled` | no pass completed in 30s, **or** 3 passes in a row hit upstream errors |
| `tpslWatcher.placed` vs `pendingTpslWatches` | `placed` flat while pending climbs **is** the silent failure |
| `tpslWatcher.lastError` | why — a 429 reads differently from a DNS failure |

Depth alone is **not** a fault: a resting limit order legitimately sits pending for up to 30
minutes. Growth that does not drain is. Watch the pair, not the number.

The log says the same thing, once per transition rather than once per 5s tick:

```bash
docker compose logs backend | grep -E 'tpsl watcher (STALLED|recovered)'
docker compose logs backend | grep 'aster tpsl watch tick failed'   # per-watch upstream failures
```

A stalled watcher does **not** make `/health` return 503. It is usually Aster being
unreachable, and restarting the container fixes nothing while taking down trading, market
data and the price relay — all of which still work. It is reported loudly and left to a
human.

### Backup verification

An untested backup is not a backup. `./deploy/backup-redis.sh` takes a dump;
`./deploy/verify-backup.sh` proves it is restorable:

```bash
./deploy/backup-redis.sh
./deploy/verify-backup.sh          # newest dump in ./backups
```

It loads the dump into a throwaway container on no network and asserts three things: Redis
accepts it, it holds data, and **an agent key inside it decrypts with the
`AGENT_KEY_ENCRYPTION_SECRET` currently in `.env`**.

The third is the whole point. The dump is ciphertext. A perfect dump plus the wrong secret is
an unrecoverable file that is indistinguishable from a working backup until the day you need
it. Nothing else tells them apart.

`PARTIAL PASS` means the dump loaded but held no `aster:agent-key:*` entry — expected before
the first EXTRA-mode user, and not a verified backup. Re-run it once a real user has approved
an agent.

Worth putting on a weekly cron. And the honest caveat: **`backup-redis.sh` writes to
`./backups` on the same VPS.** That is not off-box, and a copy sitting beside the thing it
protects survives nothing that destroys the machine. Until you `scp` it somewhere else, do
not describe this deployment as having backups.

---

## Troubleshooting

**Everything 502s right after a deploy.** nginx resolves the `backend` and `frontend`
hostnames to IPs once, at config load. Recreating those containers gives them new IPs that
nginx does not know about. `deploy.sh` reloads nginx for exactly this reason; if you started
containers by hand, do it yourself:

```bash
docker compose exec nginx nginx -s reload
```

**nginx serves the stock welcome page, or nothing listens on 443.** The templates were not
rendered. The image's entrypoint only runs its `docker-entrypoint.d/` scripts when its first
argument is literally `nginx` — which is why the `command:` in `docker-compose.yml` ends with
`exec /docker-entrypoint.sh nginx -g 'daemon off;'` rather than `exec nginx`. Do not
"simplify" that line.

**`$host` / `$remote_addr` come out blank in the config.** `NGINX_ENVSUBST_FILTER` is
missing or wrong. Without it envsubst substitutes *every* `$var` in the template, not just
`${DOMAIN}`.

**Backend is unhealthy but the site works.** That is Redis being down, by design — `/health`
reports 503 and the routes that need Redis degrade, while the rest keeps serving. Check
`docker compose logs redis`.

**Rate limiting seems to apply to everyone at once.** nginx must set `X-Forwarded-For` and
the backend must run `trustProxy: true`. Both halves are required; either alone gives you one
global bucket. Note the header is set to `$remote_addr`, deliberately overwriting whatever
the client sent — the usual `$proxy_add_x_forwarded_for` *appends*, which would let any
client pick its own rate-limit bucket and bypass the limiter entirely.

**Disk filling up.** Every service caps its logs at 10MB × 3 files. If something else is
growing, check `docker system df` and prune images — old deploy tags accumulate.

**The backend log is nothing but the same line over and over.** Almost always a Redis outage.
Identical Redis connection errors are throttled to one a minute with a `suppressedSince`
count, so a wall of them means something else is repeating — find it before it rotates the
rest of the log away (30MB total, § Observability).

**`/health` says `tpslWatcherStalled: true`.** User protections are not being placed. Check
`tpslWatcher.lastError` in the same response first: an upstream failure means Aster is
unreachable and there is nothing to fix locally, while `lastPassAt` going stale with no error
means the tick itself stopped — restart the backend. Do not restart on the first case; it
takes down trading and the price relay, which both still work.
