// Hyperliquid agent (API) wallet — the reason HL orders can be signed at all.
//
// HL L1 actions (order/cancel/modify/updateLeverage) sign over a FIXED EIP-712
// domain with chainId 1337 (see signL1Action in trading.ts). MetaMask refuses
// any eth_signTypedData_v4 whose domain.chainId differs from the active chain,
// so an L1 action signed by the user's own wallet on Arbitrum is rejected
// before it ever reaches HL:
//
//   Provided chainId "1337" must match the active chainId "42161"
//
// That is not a bug to work around — HL's own UI never wallet-signs L1
// actions either. It approves an *agent wallet*: a keypair generated in the
// browser, authorized once via the user-signed `approveAgent` action (domain
// chainId = the wallet's ACTIVE chain, so MetaMask signs it happily), after
// which every order is signed locally by the agent key with no wallet popup.
//
// Agent keys are trade-only by protocol: they can place and cancel orders and
// set leverage, but CANNOT withdraw, usdSend, or transfer. That bounds the
// blast radius of a stolen key to a hostile trader, never a drained account —
// which is what makes localStorage an acceptable home for one.
//
// Losing the key loses nothing. Funds, positions, resting orders and TP/SL
// triggers all live server-side on HL, keyed to the master address. A wiped
// key only means "cannot sign new actions until re-approved", and
// ensureHlAgent() re-approves on demand, so the loss costs one popup.

const HL_API = '/api/hl';

// A NAMED agent, deliberately. HL gives each account a single *unnamed* agent
// slot: approving an unnamed agent anywhere else (app.hyperliquid.xyz, another
// dapp) silently revokes ours. A named one survives that, which removes the
// most common cause of "my orders stopped working" in the wild.
const AGENT_NAME = 'rdoone';

// HL agent approvals last 180 days. Re-approve while there's still a week of
// runway rather than at the moment a user is trying to close a position.
const AGENT_TTL_MS     = 180 * 86_400_000;
const AGENT_RENEW_MS   = 7   * 86_400_000;

// 'Mainnet' | 'Testnet' — must match whichever HL API trading.ts talks to.
const HL_CHAIN = 'Mainnet';

const lsKey = (user: string) => `rdo_hl_agent:${user.toLowerCase()}`;

interface StoredAgent {
  privateKey: string;
  address:    string;
  user:       string;
  name:       string;
  createdAt:  number;
}

/** Thrown when the agent cannot be established at all — surfaced to the user
 *  verbatim, so these strings are written to be read by a human. */
export class HlAgentError extends Error {
  constructor(message: string) { super(message); this.name = 'HlAgentError'; }
}

function loadAgent(user: string): StoredAgent | null {
  try {
    const raw = localStorage.getItem(lsKey(user));
    if (!raw) return null;
    const rec = JSON.parse(raw) as StoredAgent;
    // Keys are namespaced per master address, but verify anyway: a record
    // that doesn't belong to this user must never be used to sign for them.
    if (!rec?.privateKey || rec.user?.toLowerCase() !== user.toLowerCase()) return null;
    if (Date.now() - rec.createdAt > AGENT_TTL_MS - AGENT_RENEW_MS) return null;
    return rec;
  } catch { return null; }
}

function saveAgent(rec: StoredAgent) {
  try { localStorage.setItem(lsKey(rec.user), JSON.stringify(rec)); } catch { /* private mode — agent lives for this page only */ }
}

/** Forget the stored agent for one address, or every address when called
 *  bare (explicit wallet disconnect). Purely local: it does not revoke the
 *  approval on HL's side, it only drops our ability to use it. */
export function clearHlAgent(user?: string) {
  try {
    if (user) { localStorage.removeItem(lsKey(user)); return; }
    for (const k of Object.keys(localStorage))
      if (k.startsWith('rdo_hl_agent:')) localStorage.removeItem(k);
  } catch { /* silent */ }
}

/** Agents HL currently recognises for `user`, straight from the exchange —
 *  the authority on whether our stored key is still good. */
async function fetchExtraAgents(user: string): Promise<Array<{ address: string; name: string; validUntil: number }>> {
  try {
    const res = await fetch(`${HL_API}/info`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'extraAgents', user }),
    });
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}

/** Read-only status for UI (a "trading key" row, a revoke affordance). Hits
 *  the network, so it's for display — never gate an order on it. */
export async function getHlAgentStatus(user: string) {
  const rec = loadAgent(user);
  if (!rec) return { approved: false, address: null as string | null, validUntil: 0 };
  const live = (await fetchExtraAgents(user))
    .find(a => a.address?.toLowerCase() === rec.address.toLowerCase());
  return {
    approved:   !!live && live.validUntil > Date.now(),
    address:    rec.address,
    validUntil: live?.validUntil ?? 0,
  };
}

/**
 * Mint a keypair and authorize it via the user-signed `approveAgent` action.
 *
 * This is the ONE wallet popup in the whole trading flow. It signs over the
 * `HyperliquidSignTransaction` domain using the wallet's ACTIVE chain id —
 * not a hardcoded 42161 — so it works whatever network the user happens to
 * be on, and never trips MetaMask's domain-chainId check.
 */
async function approveNewAgent(user: string, userSigner: any): Promise<StoredAgent> {
  const { ethers } = await import('ethers');

  // `signatureChainId` is part of the signed action and tells HL which chain
  // id to verify the signature against, so it MUST be the chain the wallet
  // actually signs on. Reading it (rather than assuming Arbitrum) is what
  // keeps approval working from BNB Chain, Ethereum, anywhere.
  let chainId = 42161;
  try { chainId = Number((await userSigner.provider.getNetwork()).chainId); } catch { /* default to Arbitrum */ }
  const signatureChainId = '0x' + chainId.toString(16);

  const agent = ethers.Wallet.createRandom();
  const nonce = Date.now();

  const domain = {
    name: 'HyperliquidSignTransaction', version: '1',
    chainId,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    'HyperliquidTransaction:ApproveAgent': [
      { name: 'hyperliquidChain', type: 'string'  },
      { name: 'agentAddress',     type: 'address' },
      { name: 'agentName',        type: 'string'  },
      { name: 'nonce',            type: 'uint64'  },
    ],
  };
  const message = {
    hyperliquidChain: HL_CHAIN,
    agentAddress:     agent.address,
    agentName:        AGENT_NAME,
    nonce,
  };

  const raw = await userSigner.signTypedData(domain, types, message);
  const signature = {
    r: raw.slice(0, 66),
    s: '0x' + raw.slice(66, 130),
    v: parseInt(raw.slice(130, 132), 16),
  };

  // signatureChainId rides in the action but NOT in the signed message —
  // HL reads it to reconstruct the domain it verifies against.
  const action = { type: 'approveAgent', ...message, signatureChainId };

  const res = await fetch(`${HL_API}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature }),
  });
  const out = await res.json();
  if (out?.status !== 'ok') {
    const why = String(out?.response ?? out?.error ?? 'unknown error');
    // Overwhelmingly the cause on a fresh wallet, and the raw text ("Must
    // deposit before performing actions") reads like a bug rather than the
    // setup step it is.
    if (/deposit/i.test(why))
      throw new HlAgentError('Deposit to Hyperliquid first — an account has to exist before it can be traded.');
    throw new HlAgentError(`Could not authorize trading key: ${why}`);
  }

  const rec: StoredAgent = {
    privateKey: agent.privateKey,
    address:    agent.address,
    user,
    name:       AGENT_NAME,
    createdAt:  Date.now(),
  };
  saveAgent(rec);
  return rec;
}

// Two actions fired back-to-back (updateLeverage then the entry order, or a
// double-clicked button) would each find no stored key and each open their own
// approval popup, leaving one agent orphaned. Share the in-flight approval.
const inFlight = new Map<string, Promise<any>>();

/**
 * The agent wallet to sign L1 actions with — approving one first if none is
 * stored, expired, or (when `revalidate`) no longer recognised by HL.
 *
 * Callers pass the user's wallet signer purely as the authority to approve
 * with; it never signs an order itself.
 */
export async function ensureHlAgent(userSigner: any, opts: { revalidate?: boolean } = {}) {
  const user = await userSigner.getAddress();
  const key  = user.toLowerCase();
  const pending = inFlight.get(key);
  if (pending) return pending;
  const p = resolveAgent(user, userSigner, opts).finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

async function resolveAgent(user: string, userSigner: any, opts: { revalidate?: boolean }) {
  const { ethers } = await import('ethers');

  let rec = loadAgent(user);

  // Only on the retry path: a stored key can be revoked exchange-side at any
  // time (user approved an unnamed agent elsewhere), and there's no local
  // signal for it. Skipped on the happy path so a normal order costs zero
  // extra round trips.
  if (rec && opts.revalidate) {
    const live = (await fetchExtraAgents(user))
      .find(a => a.address?.toLowerCase() === rec!.address.toLowerCase());
    if (!live || live.validUntil <= Date.now()) { clearHlAgent(user); rec = null; }
  }

  if (!rec) rec = await approveNewAgent(user, userSigner);
  return new ethers.Wallet(rec.privateKey);
}

/** Does this HL /exchange response mean "your agent is no longer valid"?
 *  Narrow on purpose: a broader match would re-prompt the wallet on ordinary
 *  rejections like insufficient margin. */
export function isAgentRejection(out: any): boolean {
  const msg = `${out?.response ?? ''} ${out?.error ?? ''}`;
  if (/must deposit/i.test(msg)) return false;   // account problem, not agent problem
  return /does not exist|api wallet|agent.*(invalid|expired|revoked)/i.test(msg);
}
