// Aster Pro API V3 — shared trading agent approval + signed-endpoint reads.
// Ported from the root app's lib/aster.ts (this app doesn't share hook/lib
// infrastructure with it yet).
//
// Aster deprecated the old public v2/account bulk-query endpoint this page
// used to call (confirmed live: it now 404s on Aster's own servers). The
// current V3 Pro API requires each user to approve our ONE shared trading
// agent once — an on-chain EIP-712 signature, no gas, no funds moved
// (canWithdraw is always false) — before we can read their account
// server-side. ensureAsterAgentApproved() makes that a "check first, only
// prompt if truly needed" step baked into the data load itself rather than a
// dedicated button — an already-approved wallet (e.g. one that approved via
// the main RDO ONE app, since it's the same shared agent address) loads with
// zero extra prompts; only a never-approved wallet sees its own wallet's
// native signature popup, once.

// Each user gets their OWN dedicated Aster Pro API agent keypair, minted
// and held server-side (server/lib/agent-keystore.js) — NOT one shared
// address. Aster's signed reads/trades resolve account identity from the
// signer alone (confirmed against Aster's own docs and reference client:
// GET /fapi/v3/accountWithJoinMargin, /balance, /positionRisk, /income,
// /userTrades take no `user` parameter at all), so a single shared agent
// could only ever be "live" for the one user who most recently approved
// it. Aster's own integration flow explicitly recommends this
// ("recommended: one signer per user" — asterdex.github.io/aster-api-website/
// asterCode/integration-flow/). getMyAsterAgentAddress() below fetches (and
// implicitly creates) the caller's own agent address; nothing in this file
// hardcodes one anymore.

// Aster Code (docs.asterdex.com "Aster Code" builder program): approveAgent
// "supports setting builder and maxFeeRate to approve the builder at the
// same time" — riding on the same signed call as agent approval is what lets
// us collect a per-trade fee. Per Aster's integration flow, `builder` is a
// FIXED business-identity address (used purely for fee attribution — "must
// be registered on Aster, and the Aster contract account must have a
// balance of at least 100 ASTER"), unrelated to whichever per-user agent
// actually signs a given trade. This reuses the address that used to
// double as this app's one shared agent (ASTER_SIGNER_ADDRESS in
// server/.env) — it already has approval history under it, and repurposing
// it as the fixed builder identity needs no new setup.
export const ASTER_BUILDER_ADDRESS = '0xdA480541aDB8D00E4783E5180CE70D3Da52D99F9';
export const ASTER_BUILDER_MAX_FEE_RATE = '0.0001'; // 0.01%

interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface Signer {
  signTypedData: (domain: object, types: object, value: object) => Promise<string>;
}

/** Fetches (creating on first call) `userAddress`'s own dedicated Aster
 *  agent address — never a private key, just the public address needed as
 *  `agentAddress` when signing approveAgent. See server/lib/agent-keystore.js. */
export async function getMyAsterAgentAddress(userAddress: string): Promise<string | null> {
  try {
    const res = await fetch(`/aster-agent-address?user=${encodeURIComponent(userAddress)}`);
    const data = await res.json();
    return typeof data?.agentAddress === 'string' ? data.agentAddress : null;
  } catch {
    return null;
  }
}

/**
 * Raw accountWithJoinMargin response, or null if the agent isn't approved
 * for this address (or the request failed). Field names match Aster's own
 * API verbatim — callers read totalWalletBalance/positions/etc. directly.
 *
 * GET /fapi/v3/accountWithJoinMargin itself takes no `user` parameter per
 * Aster's docs (confirmed against asterdex.github.io/aster-api-website/
 * futures-v3/account%26trades/ and github.com/asterdex/API-demo) — it
 * resolves the account from the signer alone, which is exactly why this
 * has to be a per-user agent rather than one shared one.
 */
export async function getAsterAccount(userAddress: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`/aster-signed/fapi/v3/accountWithJoinMargin?user=${encodeURIComponent(userAddress)}`);
    const data = await res.json();
    if (!data || typeof data !== 'object' || !Array.isArray((data as Record<string, unknown>).positions)) return null;
    return data;
  } catch {
    return null;
  }
}

export interface AsterAgentApproval {
  agentAddress: string;
  agentName: string;
  canPerpTrade: boolean;
  canSpotTrade: boolean;
  canWithdraw: boolean;
  expired: number;
}

/** GET /fapi/v3/agent — the list of agents `userAddress` has approved.
 *  Signed server-side by that same user's own dedicated agent key (the
 *  backend resolves which key from this `user` query param — see
 *  server/routes/proxy.js's requireUserAgent) — this lookup endpoint DOES
 *  accept and honor an explicit `user` param, unlike accountWithJoinMargin/
 *  income/etc (see getAsterAccount's doc comment for the endpoints that
 *  don't). */
export async function getAsterAgents(userAddress: string): Promise<AsterAgentApproval[]> {
  try {
    const res = await fetch(`/aster-signed/fapi/v3/agent?user=${encodeURIComponent(userAddress)}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Is `userAddress`'s own dedicated agent (`agentAddress`, from
 * getMyAsterAgentAddress) currently approved and not expired — via GET
 * /fapi/v3/agent, the documented, per-user-scoped way to check this.
 * Previously this was inferred by probing accountWithJoinMargin and
 * treating a non-null response as "approved" — which conflated two
 * different things, since accountWithJoinMargin doesn't take a `user`
 * param at all and would return SOME account as long as the (then shared)
 * agent had a live mapping to anyone.
 */
export async function isAsterAgentApproved(userAddress: string, agentAddress: string): Promise<boolean> {
  const agents = await getAsterAgents(userAddress);
  const now = Date.now();
  return agents.some(a =>
    a.agentAddress?.toLowerCase() === agentAddress.toLowerCase() &&
    a.canPerpTrade &&
    (!a.expired || a.expired > now),
  );
}

export interface AsterBuilderApproval {
  userAddress: string;
  builderAddress: string;
  maxFeeRate: number;
  builderName: string;
}

/** GET /fapi/v3/builder — the list of builders this user has approved, with
 *  their fee-rate caps. Signed server-side by our agent (same pattern as
 *  every other /aster-signed/* read). */
export async function getAsterBuilders(userAddress: string): Promise<AsterBuilderApproval[]> {
  try {
    const res = await fetch(`/aster-signed/fapi/v3/builder?user=${encodeURIComponent(userAddress)}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/** Is OUR builder address specifically approved (with a nonzero fee cap) for
 *  this user — separate from agent approval, since a user could have
 *  approved the agent (reads/trades) before this builder-fee field existed
 *  and never been asked to approve the fee itself. */
export async function isAsterBuilderApproved(userAddress: string): Promise<boolean> {
  const builders = await getAsterBuilders(userAddress);
  return builders.some(b => b.builderAddress?.toLowerCase() === ASTER_BUILDER_ADDRESS.toLowerCase() && b.maxFeeRate > 0);
}

type Eip712Value = string | number | boolean;

function capitalizeKey(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

// Matches Aster's own reference client's type-inference exactly (see
// signAsterManagementAction's doc comment) — booleans and integers get
// their natural Solidity type, everything else (including decimal amounts
// like maxFeeRate, which must stay a string) falls through to `string`.
function inferEip712Type(value: Eip712Value): string {
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number' && Number.isInteger(value)) return 'uint256';
  return 'string';
}

/**
 * Signs an Aster Code "management" action (ApproveAgent, ApproveBuilder,
 * UpdateAgent, ...) with the user's own wallet. This is a genuinely
 * different EIP-712 scheme from every other signed call in this file: a
 * per-action typed struct (dynamic primaryType, e.g. "ApproveAgent"), not
 * the generic Message{msg:string} wrapper accountWithJoinMargin/income/etc
 * use (that wrapper is for the OTHER Aster signature mode — "trading",
 * signed by the agent's own key, always domain chainId 1666; see
 * server/lib/aster-auth.js). Management actions are signed by the user's
 * main wallet, field names are capitalized (agentName -> AgentName), and
 * domain chainId is fixed at 56 — none of which the prose docs spell out in
 * full; ported verbatim from Aster's reference implementation
 * (github.com/asterdex/API-demo/tree/main/aster-code-demo, utils.js's
 * signEIP712Main + 01_approveAgent.js) since getting this wrong just means
 * a silently-rejected signature, not a dangerous one — but it's still worth
 * getting right the first time given this grants trading authority.
 */
async function signAsterManagementAction(
  signer: Signer,
  primaryType: string,
  params: Record<string, Eip712Value>,
): Promise<string> {
  const message: Record<string, Eip712Value> = {};
  const fields: Array<{ name: string; type: string }> = [];
  for (const [key, value] of Object.entries(params)) {
    const capKey = capitalizeKey(key);
    message[capKey] = value;
    fields.push({ name: capKey, type: inferEip712Type(value) });
  }
  const domain = { name: 'AsterSignTransaction', version: '1', chainId: 56, verifyingContract: '0x0000000000000000000000000000000000000000' };
  return signer.signTypedData(domain, { [primaryType]: fields }, message);
}

/**
 * Calls POST /fapi/v3/approveAgent — the Aster Code builder-program
 * endpoint (asterdex.github.io/aster-api-website/asterCode/endpoints/) —
 * NOT the older /fapi/v3/registerAndApproveAgent from the general V3 docs,
 * which this used to call: registerAndApproveAgent doesn't document (and,
 * tested, doesn't honor) the builder/maxFeeRate/builderName fields needed
 * to collect a per-trade fee.
 */
export async function approveAsterAgent(userAddress: string, agentAddress: string, signer: Signer): Promise<{ ok: boolean; message: string }> {
  const nonce = Date.now() * 1000; // microseconds, per Aster's V3 nonce convention
  const expired = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year validity
  const params: Record<string, Eip712Value> = {
    agentName: 'RDOONE',
    agentAddress,
    ipWhitelist: '',
    expired,
    canSpotTrade: false,
    canPerpTrade: true,
    canWithdraw: false,
    builder: ASTER_BUILDER_ADDRESS,
    maxFeeRate: ASTER_BUILDER_MAX_FEE_RATE,
    builderName: 'RDOONE',
    user: userAddress,
    nonce,
  };

  try {
    const signature = await signAsterManagementAction(signer, 'ApproveAgent', params);
    const res = await fetch('/aster-approve-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, signature }),
    });
    const data = await res.json();
    return { ok: data.code === 200, message: data.msg ?? 'Unknown response' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Request failed' };
  }
}

/** Check-then-approve wrapper: only prompts the wallet for a signature when
 *  the agent AND builder fee aren't already both approved. A user who
 *  approved the agent before this builder-fee field existed (or vice versa)
 *  gets re-prompted once to cover whichever is missing — the same signed
 *  call sets both. `getSigner` is lazy so wallet-side prep (network switch,
 *  building the signer) only happens on the not-fully-approved branch, never
 *  when already approved.
 *
 *  Always resolves `userAddress`'s own dedicated agent address first (a
 *  cheap Redis-backed lookup, never a wallet prompt) — needed to know what
 *  to check approval against, and what to sign if approval is still needed. */
export async function ensureAsterAgentApproved(
  userAddress: string,
  getSigner: () => Promise<Signer>,
): Promise<{ ok: boolean; alreadyApproved: boolean; message: string }> {
  const agentAddress = await getMyAsterAgentAddress(userAddress);
  if (!agentAddress) {
    return { ok: false, alreadyApproved: false, message: 'Could not allocate a trading agent — try again' };
  }
  const [agentOk, builderOk] = await Promise.all([
    isAsterAgentApproved(userAddress, agentAddress),
    isAsterBuilderApproved(userAddress),
  ]);
  if (agentOk && builderOk) {
    return { ok: true, alreadyApproved: true, message: 'Agent already approved' };
  }
  try {
    const signer = await getSigner();
    const result = await approveAsterAgent(userAddress, agentAddress, signer);
    return { ok: result.ok, alreadyApproved: false, message: result.message };
  } catch (e) {
    return { ok: false, alreadyApproved: false, message: e instanceof Error ? e.message : 'Could not get wallet signer' };
  }
}

export interface EvmNetworkOption {
  chainId: string; // hex, e.g. '0x38'
  name: string;
  short: string; // small badge glyph, matches this file's evm-tok-dot convention
  color: string;
  bg: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
  blockExplorerUrls: string[];
}

// The networks this app's Aster/portfolio flow cares about — BNB Chain for
// Aster's approval signature, Ethereum as the common default, Arbitrum for
// the perps-deposit flow elsewhere on this page. Matches the network
// switcher on Aster's own site (asterdex.com), which is THEIR app chrome —
// not proof every wallet supports every entry here (see the Phantom note
// on getEvmProviderFor below).
export const EVM_NETWORKS: EvmNetworkOption[] = [
  { chainId: '0x38', name: 'BNB Chain', short: 'B', color: '#F0B90B', bg: '#3a2f0a', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: ['https://bsc-dataseed.binance.org/'], blockExplorerUrls: ['https://bscscan.com'] },
  { chainId: '0x1', name: 'Ethereum', short: 'Ξ', color: '#627EEA', bg: '#1b2429', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://eth.llamarpc.com'], blockExplorerUrls: ['https://etherscan.io'] },
  { chainId: '0xa4b1', name: 'Arbitrum', short: 'A', color: '#28A0F0', bg: '#0f2a3d', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://arb1.arbitrum.io/rpc'], blockExplorerUrls: ['https://arbiscan.io'] },
];

/**
 * Picks an EVM provider that can actually switch to `chainId` for
 * `expectedAddress` — needed because Phantom's EVM mode has a hardcoded
 * chain allowlist (Ethereum, Base, Polygon, Monad testnet — confirmed
 * against Phantom's own docs/help center) that does NOT include BNB Chain
 * or Arbitrum. wallet_switchEthereumChain AND wallet_addEthereumChain both
 * fail for Phantom on those; there's no request payload that works around
 * it, it's a capability gap, not a formatting bug. If Phantom is the active
 * wallet and another injected wallet (e.g. MetaMask) already has the SAME
 * address connected, prefer that one instead — checked via eth_accounts,
 * which never prompts, so this never surprises the user with an unexpected
 * connection request. Falls back to whatever's available (typically
 * Phantom) if no matching alternative exists, so the caller can still
 * surface a clear, specific error instead of a silent failure. Ethereum
 * mainnet is one of the few chains Phantom natively supports, so it's
 * exempted from the swap.
 */
export async function getEvmProviderFor(expectedAddress: string, chainId: string): Promise<EIP1193Provider | null> {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ethereum?: (EIP1193Provider & { providers?: EIP1193Provider[]; isPhantom?: boolean }); phantom?: { ethereum?: EIP1193Provider & { isPhantom?: boolean } } };
  const candidates: (EIP1193Provider & { isPhantom?: boolean })[] = [];
  if (Array.isArray(w.ethereum?.providers)) candidates.push(...(w.ethereum.providers as (EIP1193Provider & { isPhantom?: boolean })[]));
  else if (w.ethereum) candidates.push(w.ethereum);
  if (w.phantom?.ethereum && !candidates.includes(w.phantom.ethereum)) candidates.push(w.phantom.ethereum);

  if (chainId === '0x1') return candidates[0] ?? null;

  const nonPhantom = candidates.filter((p) => !p.isPhantom);
  for (const p of nonPhantom) {
    try {
      const accounts = (await p.request({ method: 'eth_accounts' })) as string[];
      if (accounts?.some((a) => a.toLowerCase() === expectedAddress.toLowerCase())) return p;
    } catch { /* try the next candidate */ }
  }
  return candidates[0] ?? null;
}

/** Switch (or add, if not present) `provider` to `network` — the shared
 *  switch/add/error-message logic behind both the network switcher UI and
 *  ensureBscNetwork below. */
export async function switchEvmNetwork(provider: EIP1193Provider, network: EvmNetworkOption): Promise<{ ok: boolean; reason?: string }> {
  const isPhantom = (provider as { isPhantom?: boolean })?.isPhantom;
  const unsupportedMsg = isPhantom
    ? `Phantom doesn't support ${network.name} — connect with MetaMask (or another EVM wallet) instead.`
    : `Your wallet couldn't switch to ${network.name}.`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: network.chainId }] });
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === 4902) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: network.chainId,
            chainName: network.name,
            nativeCurrency: network.nativeCurrency,
            rpcUrls: network.rpcUrls,
            blockExplorerUrls: network.blockExplorerUrls,
          }],
        });
        return { ok: true };
      } catch {
        return { ok: false, reason: unsupportedMsg };
      }
    }
    return { ok: false, reason: unsupportedMsg };
  }
}

/** Thin BSC-specific wrapper kept for the existing approval-flow call site
 *  — see switchEvmNetwork/EVM_NETWORKS above for the general version this
 *  now delegates to. */
export async function getBscCapableProvider(expectedAddress: string): Promise<EIP1193Provider | null> {
  return getEvmProviderFor(expectedAddress, '0x38');
}

/**
 * Aster's approveAgent signature is hardcoded to chainId 56 (BSC) — some
 * wallets reject eth_signTypedData_v4 if that domain chainId doesn't match
 * the wallet's active network, so switch (or add, if not present) before
 * ever requesting the signature.
 *
 * NOTE: this fails unconditionally for Phantom (see getEvmProviderFor's
 * doc comment) — the caller should route through getBscCapableProvider()
 * first so a same-address MetaMask (or similar) gets used instead when
 * Phantom is what's connected.
 */
export async function ensureBscNetwork(provider: EIP1193Provider): Promise<{ ok: boolean; reason?: string }> {
  return switchEvmNetwork(provider, EVM_NETWORKS[0]);
}

export interface AsterIncomeEntry {
  symbol: string;
  income: number;
  time: number;
}

const INCOME_WINDOW_MS = 6.9 * 24 * 60 * 60 * 1000; // just under Aster's 7-day-per-call cap
const INCOME_BATCH = 5;

/** Realized PnL history via GET /fapi/v3/income (incomeType=REALIZED_PNL) —
 *  covers every symbol in one logical fetch, unlike /fapi/v3/userTrades
 *  which requires a mandatory `symbol` and can't answer "all of this
 *  account's trades." Tradeoff: entries carry pnl + symbol + time, not
 *  per-trade price/size/side the way the old v1/userTrades response did. */
export async function getAsterIncomeHistory(sinceMs: number, userAddress: string): Promise<AsterIncomeEntry[]> {
  const now = Date.now();
  const windows: Array<{ start: number; end: number }> = [];
  for (let end = now; end > sinceMs; end -= INCOME_WINDOW_MS) {
    windows.push({ start: Math.max(sinceMs, end - INCOME_WINDOW_MS), end });
  }

  const out: AsterIncomeEntry[] = [];
  for (let i = 0; i < windows.length; i += INCOME_BATCH) {
    const batch = windows.slice(i, i + INCOME_BATCH);
    const results = await Promise.all(batch.map(async ({ start, end }) => {
      try {
        const res = await fetch(`/aster-signed/fapi/v3/income?incomeType=REALIZED_PNL&startTime=${start}&endTime=${end}&limit=1000&user=${encodeURIComponent(userAddress)}`);
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      } catch {
        return [];
      }
    }));
    results.forEach(entries => {
      (entries as Array<Record<string, string>>).forEach(e => {
        out.push({
          symbol: String(e.symbol ?? '').replace(/USDT$/, ''),
          income: parseFloat(e.income ?? '0'),
          time: Number(e.time),
        });
      });
    });
  }

  return out.sort((a, b) => a.time - b.time);
}
