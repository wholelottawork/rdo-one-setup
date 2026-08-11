// Aster V3 withdrawal — the ONE signature the browser has to produce.
//
// Mirrors backend/src/lib/aster-withdraw.ts, which verifies what this file
// builds. The two must agree byte for byte; both are pinned by tests
// (./asterWithdraw.test.ts and backend/src/lib/aster-withdraw.test.ts).
//
// A withdrawal carries two signatures. The other one — the V3 request-auth
// wrapper on domain chainId 1666 — used to be built here too, and that made
// Aster withdrawals impossible in MetaMask: it refuses to sign a typed-data
// domain whose chainId is not the connected chain, and Aster publishes no RPC
// for 1666, so there was nothing to switch to. It is now signed by the user's
// own server-held agent key (backend/src/lib/aster-auth.ts).
//
// This one stays in the wallet, and that is the security property rather than
// an accident of layering: Aster REJECTS an agent-signed Action (measured, see
// docs/aster-withdrawal-findings.md), so this signature over destination,
// amount and fee is the sole authorization to move funds and the server cannot
// manufacture it.

export const ASTER_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ASTER_CHAIN_NAME = 'Mainnet';

// Aster's `shortenName`, not the chain's display name: chainId 56 is 'BSC'
// even though Aster's own UI reads "BNB Chain".
export const ASTER_CHAIN_SHORT_NAME: Record<string, string> = {
  '1': 'ETH',
  '56': 'BSC',
  '204': 'opBNB',
  '8453': 'Base',
  '42161': 'Arbitrum',
  '534352': 'Scroll',
};

const EIP712_DOMAIN_FIELDS = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

// TWO FIELD NAMES CONTAIN A SPACE — "destination Chain" and "aster chain".
// Not typos: read out of Aster's own web bundle, documented nowhere. One
// wrong character produces a valid-looking signature that Aster rejects with
// "Signature check failed". Order is part of the type hash as well.
export const ASTER_WITHDRAW_ACTION_FIELDS = [
  { name: 'type', type: 'string' },
  { name: 'destination', type: 'address' },
  { name: 'destination Chain', type: 'string' },
  { name: 'token', type: 'string' },
  { name: 'amount', type: 'string' },
  { name: 'fee', type: 'string' },
  { name: 'nonce', type: 'uint256' },
  { name: 'aster chain', type: 'string' },
];

/** Aster's own client normalizes ".5" to "0.5" before signing. */
export function normalizeAsterAmount(value: string): string {
  return value.startsWith('.') ? `0${value}` : value;
}

/** Plain decimal, never exponent notation: a signature over "1.7e-4" does not
 *  match one over "0.00017", and JS reaches exponent form on its own below
 *  1e-6. Aster's fee endpoint returns small fees already in that form. */
export function toPlainDecimal(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`Not a finite number: ${value}`);
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
  if (!m) return s;
  const sign = m[1];
  const intPart = m[2];
  const fracPart = m[3] ?? '';
  const digits = intPart + fracPart;
  const pointPos = intPart.length + Number(m[4]);
  let out: string;
  if (pointPos <= 0) out = `0.${'0'.repeat(-pointPos)}${digits}`;
  else if (pointPos >= digits.length) out = digits + '0'.repeat(pointPos - digits.length);
  else out = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  return sign + out;
}

export interface AsterWithdrawParams {
  /** Destination chain, e.g. '42161' for Arbitrum. */
  chainId: string;
  /** Where the funds go. */
  receiver: string;
  /** Token symbol in Aster's terms, e.g. 'USDT'. */
  asset: string;
  /** Token units, plain decimal string — NOT wei. */
  amount: string;
  /** Token units, plain decimal string. Fetched from Aster, never guessed. */
  fee: string;
  /** Microseconds. Separate from the request `nonce`; the two may differ by
   *  up to an hour. */
  userNonce: string;
}

/**
 * Signature 2 — the withdrawal authorization itself, domain `Aster` on the
 * DESTINATION chain. This is what actually moves funds, and it binds
 * destination, amount and fee, so the user's wallet shows them.
 */
export function buildAsterWithdrawTypedData(p: AsterWithdrawParams) {
  const shortName = ASTER_CHAIN_SHORT_NAME[p.chainId];
  if (!shortName) throw new Error(`Aster does not support withdrawals to chain ${p.chainId}`);
  return {
    types: {
      EIP712Domain: EIP712_DOMAIN_FIELDS,
      Action: ASTER_WITHDRAW_ACTION_FIELDS,
    },
    primaryType: 'Action',
    domain: {
      name: 'Aster',
      version: '1',
      chainId: Number(p.chainId),
      verifyingContract: ASTER_ZERO_ADDRESS,
    },
    message: {
      type: 'Withdraw',
      destination: p.receiver,
      'destination Chain': shortName,
      token: p.asset,
      amount: p.amount,
      fee: p.fee,
      nonce: p.userNonce,
      'aster chain': ASTER_CHAIN_NAME,
    },
  };
}

/** Microsecond nonce, per Aster's V3 convention. */
export function asterNonce(): string {
  return String(Date.now() * 1000);
}
