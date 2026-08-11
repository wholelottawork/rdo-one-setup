# Aster withdrawals: what was measured, and how we know

The runnable spike that produced this has been deleted; this is its result.
It is kept because the behaviour below is undocumented by Aster, was expensive
to establish, and several source comments depend on it being written down
somewhere — the previous spike's evidence file was referenced by four files
and went missing, which is the mistake this avoids.

Run 2026-08-11 against Aster mainnet (`fapi.asterdex.com`) with a real funded
test account. Raw responses are in `results/` (gitignored; the substance is
transcribed below so the evidence survives — the previous spike's
`todo/01-RESULT.md` is referenced by four source files and is missing from the
repo, which is the mistake this file exists to avoid).

## Headline — the best available outcome

An Aster agent registered with `canWithdraw: true`:

* **CAN** sign the chainId-1666 V3 auth wrapper — the signature MetaMask
  refuses. So the MetaMask wall is solvable by having the server sign it.
* **CANNOT** sign the withdrawal Action. Aster rejects it with
  `Invalid signature. Please sign again.`

Those two facts together are the good case. The server can supply exactly the
signature a wallet cannot make, and is **structurally incapable** of originating
a withdrawal on its own, because the Action — which binds destination, amount
and fee — must come from the user's own key. The agent-key store never becomes a
hot wallet. That is safety by construction, not by convention.

Full matrix, all run live at 0.002 BNB on chain 56, fee 0.00017:

| variant | sig A (1666 wrapper) | sig B (withdraw Action) | result | evidence |
|---|---|---|---|---|
| `control` | user EOA | user EOA | **ACCEPTED** | withdrawId 1139506291253010432, hash `0x63e2d9dc…805a` |
| `agent-wrapper` | **agent** | user EOA | **ACCEPTED** | withdrawId 1139506292890705920, hash `0x72227dd1…1139` |
| `agent-type` (`signatureType=AGENT`) | **agent** | user EOA | **ACCEPTED** | — |
| `agent-both` | **agent** | **agent** | **REJECTED** | `code -1000 "Invalid signature. Please sign again."` |

Confirmed executed rather than merely acknowledged: after the first two,
withdrawable BNB fell 0.019 → 0.015, exactly 2 × 0.002.

`signatureType` appears not to be load-bearing — `EOA` and `AGENT` were both
accepted with the same signer arrangement. Do not read meaning into it.

### Caveat on how this was reported

The spike's own verdict printer got this run WRONG, announcing "No agent variant
accepted — the API-key/agent approach is dead" for the `agent-both,agent-type`
batch. Two bugs, both now fixed: it never considered `agent-type` at all, and it
treated a variant *absent from the batch* as a variant that *failed*, so any
partial run produced a confident false conclusion. The table above is read from
the raw per-variant responses, not from that summary line.

## Other findings, all new

**`ipWhitelist` is MANDATORY when `canWithdraw: true`.** Approving without it is
rejected outright:

```
HTTP 400 {"error":"api withdraw permission must specify IP."}
```

Undocumented. With `--ip 5.181.92.27` the same approval returned
`{"code":200,"msg":"success"}`, and `/fapi/v3/agent` echoes back
`ipWhitelist:"5.181.92.27"`, `canWithdraw:true`.

Consequence for production: a withdraw-capable agent **cannot exist** without a
pinned IP, and agents cannot be amended through the API. The deployment
therefore needs a **static egress IP**, permanently. Migrating hosts, adding a
node, or an egress rotation invalidates every user's agent at once and forces
all of them to re-approve. Confirm the real deployment can guarantee this before
building on it.

**Agent-signed reads work.** `/fapi/v3/accountWithJoinMargin`, `/fapi/v3/agent`
and `/fapi/v3/aster/user-withdraw-info` all returned 200 signed by the agent key
on domain chainId 1666, no wallet involved.

**Withdrawable balance is not `availableBalance`.** The test account showed
`availableBalance` 12.07 USDT but only **1.09 USDT** was withdrawable. Aster
publishes the real number per asset per chain via
`/fapi/v3/aster/user-withdraw-info` → `balances[ASSET].chainBalances[CHAIN]`
(`perpMaxWithdrawAmount`, `chainLimit`, `withdrawFee`). That endpoint requires a
`signer`, which is why the app has never read it.

**Withdrawal capacity is per asset AND per chain.** On this account USDT was
withdrawable only on 42161, BNB only on 56. Attempting USDT on chain 56 fails
with `code -1000 "You've exceeded the withdrawal limit for this chain."` — a
limit check, NOT a permission error. Anything the app builds on top of this
should read `user-withdraw-info` rather than inferring capacity from the account
balance.

## If this becomes production

The shape of the change is small and the security claim mostly survives.

Today the browser makes both signatures, and MetaMask cannot make sig A. Under
`agent-wrapper` the browser makes only sig B — domain `Aster`, destination
chainId, which MetaMask signs without complaint — and the server adds sig A with
that user's agent key before forwarding. Nothing else about the flow moves.

The existing withdrawal verification stays exactly as valuable: the backend must
still recover sig B and check it against `user`, destination, amount and fee,
because sig B remains the only thing authorizing the movement of funds.

Wording to revisit, since all of these assert the server holds no withdrawal
capability at all — `backend/src/routes/aster.ts` ("THE SERVER HOLDS NO
WITHDRAWAL CAPABILITY"), `backend/src/lib/aster-withdraw.ts`,
`frontend/lib/asterWithdraw.ts`, `HANDOFF.md`, `deploy/RUNBOOK.md`,
`backend/.env.example`, `deploy/backup-redis.sh`. The accurate replacement is
narrower and now proven: *the server cannot originate a withdrawal, because
Aster rejects an agent-signed withdrawal Action.*

Two operational prerequisites, neither optional:

1. **A permanently static egress IP.** `ipWhitelist` is mandatory for a
   withdraw-capable agent and agents cannot be amended, so an IP change
   invalidates every user's agent at once.
2. **Agents must be re-approved with `canWithdraw: true`.** Existing per-user
   agents are trade-only, and the flag cannot be added to an existing agent —
   `approveAgent` mints a new one. Note this raises what a leaked keystore
   costs: not a drain (sig B still required), but it does hand an attacker the
   ability to complete withdrawals the user has separately authorized.

## Details other files cite

Kept here because source comments point at this document for them.

**The auth wrapper is chainId 1666, not 56.** Aster's docs mandate 56 for the
unrelated `approveAgent` scheme, and reusing 56 for the withdrawal wrapper fails
signature verification. The two schemes look similar and are not
interchangeable — see `asterAuthDomain()` vs the management-action domain.

**Fees arrive in exponent notation and must be signed as plain decimals.** The
fee is a SIGNED field, so it has to be quoted before the wallet prompt and
carried through unchanged. Aster's `estimateFee` returned `gasCost: 1.7E-4` for
BNB on BSC, and the accepted signature carried the string `"0.00017"`. A
signature over `"1.7e-4"` does not match one over `"0.00017"`. JS reaches
exponent form on its own below 1e-6, so this is on the live path for any
cheap-gas chain rather than a theoretical edge — hence `toPlainDecimal`.

Observed fees at the time of the run: 0.11 USDT on BSC, 0.51 USDT on Arbitrum,
0.00017 BNB on BSC. Treat as illustrative, not fixed — always quote.

**The withdrawal endpoint is `POST /fapi/v3/aster/user-withdraw`.** An older
`/fapi/v1/withdraw` with `X-MBX-APIKEY` + HMAC does not exist in Aster's API,
in V1 or V3, and the V1 credentials it wanted stopped being issuable on
2026-03-25.
