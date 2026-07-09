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

export const ASTER_AGENT_ADDRESS = '0xdA480541aDB8D00E4783E5180CE70D3Da52D99F9';

// Aster Code (docs.asterdex.com "Aster Code" builder program): approveAgent
// "supports setting builder and maxFeeRate to approve the builder at the
// same time" — riding on the same signed call as agent approval is what lets
// us collect a per-trade fee. builder is paid to the same address as the
// agent signer; maxFeeRate is the cap the user approves.
export const ASTER_BUILDER_ADDRESS = ASTER_AGENT_ADDRESS;
export const ASTER_BUILDER_MAX_FEE_RATE = '0.0001'; // 0.01%

interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

interface Signer {
  signTypedData: (domain: object, types: object, value: object) => Promise<string>;
}

/** Raw accountWithJoinMargin response, or null if the agent isn't approved
 *  for this address (or the request failed). Field names match Aster's own
 *  API verbatim — callers read totalWalletBalance/positions/etc. directly. */
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

/** Aster has no dedicated "is this agent approved?" endpoint — infer it by
 *  probing the same signed read the portfolio load needs anyway, so this
 *  adds no extra request weight when wired into that path. */
export async function isAsterAgentApproved(userAddress: string): Promise<boolean> {
  return (await getAsterAccount(userAddress)) !== null;
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

/** Field order in the signed message is significant — Aster rejects the
 *  same values signed in any order other than exactly this one. */
export async function approveAsterAgent(userAddress: string, signer: Signer): Promise<{ ok: boolean; message: string }> {
  const nonce = Date.now() * 1000; // microseconds, per Aster's V3 nonce convention
  const expired = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year validity
  const chainId = 56; // BSC — required for EVM addresses per Aster's docs
  const fields = {
    user: userAddress,
    nonce: String(nonce),
    agentName: 'RDOONE',
    agentAddress: ASTER_AGENT_ADDRESS,
    expired: String(expired),
    signatureChainId: String(chainId),
    canSpotTrade: 'false',
    canPerpTrade: 'true',
    canWithdraw: 'false',
    ipWhitelist: '',
    builder: ASTER_BUILDER_ADDRESS,
    maxFeeRate: ASTER_BUILDER_MAX_FEE_RATE,
    builderName: 'RDOONE',
  };
  const msg = new URLSearchParams(fields).toString();
  const domain = { name: 'AsterSignTransaction', version: '1', chainId, verifyingContract: '0x0000000000000000000000000000000000000000' };
  const types = { Message: [{ name: 'msg', type: 'string' }] };

  try {
    const signature = await signer.signTypedData(domain, types, { msg });
    const res = await fetch('/aster-register-agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...fields, signature }),
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
 *  when already approved. */
export async function ensureAsterAgentApproved(
  userAddress: string,
  getSigner: () => Promise<Signer>,
): Promise<{ ok: boolean; alreadyApproved: boolean; message: string }> {
  const [agentOk, builderOk] = await Promise.all([
    isAsterAgentApproved(userAddress),
    isAsterBuilderApproved(userAddress),
  ]);
  if (agentOk && builderOk) {
    return { ok: true, alreadyApproved: true, message: 'Agent already approved' };
  }
  try {
    const signer = await getSigner();
    const result = await approveAsterAgent(userAddress, signer);
    return { ok: result.ok, alreadyApproved: false, message: result.message };
  } catch (e) {
    return { ok: false, alreadyApproved: false, message: e instanceof Error ? e.message : 'Could not get wallet signer' };
  }
}

/** Aster's registerAndApproveAgent signature is hardcoded to chainId 56
 *  (BSC) — some wallets reject eth_signTypedData_v4 if that domain chainId
 *  doesn't match the wallet's active network, so switch (or add, if not
 *  present) before ever requesting the signature. */
export async function ensureBscNetwork(provider: EIP1193Provider): Promise<boolean> {
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x38' }] });
    return true;
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === 4902) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: '0x38',
            chainName: 'BNB Smart Chain',
            nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
            rpcUrls: ['https://bsc-dataseed.binance.org/'],
            blockExplorerUrls: ['https://bscscan.com'],
          }],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
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
