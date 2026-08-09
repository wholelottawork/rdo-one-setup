import { isAddress, verifyTypedData, type TypedDataField } from 'ethers';

// Aster V3 withdrawal — POST /fapi/v3/aster/user-withdraw.
//
// A withdrawal carries TWO EIP-712 signatures, both made by the USER's own
// wallet, over two completely different domains. Keeping them apart is the
// whole job of this file:
//
//   1. the V3 auth wrapper  — domain AsterSignTransaction, chainId 1666,
//      Message{msg:string} where msg is the literal query string. Identical
//      to every other signed V3 call (src/lib/aster-auth.ts) except that the
//      signer is the user, not an agent, and `signer` is omitted entirely.
//   2. `userSignature`      — domain Aster, chainId of the DESTINATION chain,
//      an Action struct naming destination/token/amount/fee. This is the
//      actual authorization to move funds.
//
// Neither can be produced server-side: the server holds no key that Aster
// will accept for a withdrawal (an agent registered with canWithdraw:false is
// rejected at the permission check — see todo/01-RESULT.md, evidence row 9).
// So this module never signs. It VERIFIES what the browser produced, then the
// route forwards it verbatim.
//
// Verifying here is not ceremony. `user` is a public address anyone can type,
// and the route is a passthrough; recovering both signatures locally is what
// proves the caller controls `user` AND that the destination, amount and fee
// on the wire are the ones the wallet was actually shown. Without it this
// endpoint is an open relay that will happily forward a mangled request.

export const ASTER_AUTH_CHAIN_ID = 1666;
export const ASTER_ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const ASTER_CHAIN_NAME = 'Mainnet';

// Aster's `shortenName`, NOT the chain's display name — read out of Aster's
// own web bundle (getNetworkShortenNameById in NetworkSwitch-PEShS2I6.js).
// chainId 56 is "BSC", even though Aster's own UI shows "BNB Chain". It is
// undocumented and getting it wrong yields "Signature check failed".
export const ASTER_CHAIN_SHORT_NAME: Record<string, string> = {
  '1': 'ETH',
  '56': 'BSC',
  '204': 'opBNB',
  '8453': 'Base',
  '42161': 'Arbitrum',
  '534352': 'Scroll',
};

export const ASTER_AUTH_TYPES: Record<string, TypedDataField[]> = {
  Message: [{ name: 'msg', type: 'string' }],
};

// TWO OF THESE FIELD NAMES CONTAIN A SPACE — "destination Chain" and
// "aster chain". They are not typos and they are not documented anywhere;
// they were read byte-for-byte out of Aster's shipped bundle. A single
// character wrong here produces a perfectly valid signature that Aster
// rejects with "Signature check failed" and nothing else to go on. The order
// is part of the type hash too, so it is equally load-bearing.
export const ASTER_WITHDRAW_ACTION_TYPES: Record<string, TypedDataField[]> = {
  Action: [
    { name: 'type', type: 'string' },
    { name: 'destination', type: 'address' },
    { name: 'destination Chain', type: 'string' },
    { name: 'token', type: 'string' },
    { name: 'amount', type: 'string' },
    { name: 'fee', type: 'string' },
    { name: 'nonce', type: 'uint256' },
    { name: 'aster chain', type: 'string' },
  ],
};

/** Domain of signature 1 — the request-auth wrapper. chainId is ALWAYS 1666,
 *  whoever signs it. (Aster's docs mandate 56 for the unrelated approveAgent
 *  scheme; using 56 here fails signature verification — proven in
 *  todo/01-RESULT.md.) */
export function asterAuthDomain() {
  return {
    name: 'AsterSignTransaction',
    version: '1',
    chainId: ASTER_AUTH_CHAIN_ID,
    verifyingContract: ASTER_ZERO_ADDRESS,
  };
}

/** Domain of signature 2 — the withdrawal authorization. Different name,
 *  different chainId (the DESTINATION chain, e.g. 42161). Do not merge this
 *  with asterAuthDomain(). */
export function asterWithdrawActionDomain(chainId: number) {
  return {
    name: 'Aster',
    version: '1',
    chainId,
    verifyingContract: ASTER_ZERO_ADDRESS,
  };
}

export interface AsterWithdrawFields {
  chainId: string;
  asset: string;
  amount: string;
  fee: string;
  receiver: string;
  userNonce: string;
  signatureType: string;
  user: string;
  nonce: string;
}

/** The Action message signature 2 covers. `amount`/`fee` are TOKEN UNITS as
 *  plain decimal strings ("1.23"), never wei and never exponent notation. */
export function buildAsterWithdrawAction(f: {
  chainId: string;
  receiver: string;
  asset: string;
  amount: string;
  fee: string;
  userNonce: string;
}): Record<string, string> {
  const shortName = ASTER_CHAIN_SHORT_NAME[f.chainId];
  if (!shortName) throw new Error(`Unsupported Aster withdrawal chainId: ${f.chainId}`);
  return {
    type: 'Withdraw',
    destination: f.receiver,
    'destination Chain': shortName,
    token: f.asset,
    amount: f.amount,
    fee: f.fee,
    nonce: f.userNonce,
    'aster chain': ASTER_CHAIN_NAME,
  };
}

// Aster's own client normalizes both signed amounts before hashing them, and
// a signature over "1.7e-4" does not match one over "0.00017". JS reaches
// exponent notation on its own below 1e-6, and Aster's fee endpoint hands
// back small fees ALREADY in that form (gasCost: 1.7E-4), so this is on the
// live path for any cheap-gas chain, not a theoretical edge.
export function toPlainDecimal(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new Error(`Not a finite number: ${value}`);
  const s = String(n);
  const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, intPart, fracPart = '', expStr] = m;
  const digits = intPart + fracPart;
  const pointPos = intPart.length + Number(expStr);
  let out: string;
  if (pointPos <= 0) out = `0.${'0'.repeat(-pointPos)}${digits}`;
  else if (pointPos >= digits.length) out = digits + '0'.repeat(pointPos - digits.length);
  else out = `${digits.slice(0, pointPos)}.${digits.slice(pointPos)}`;
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '');
  return sign + out;
}

/** The other normalization Aster's client applies: ".5" -> "0.5". */
export function normalizeAsterAmount(value: string): string {
  return value.startsWith('.') ? `0${value}` : value;
}

// Token units, plain decimal, no sign, no exponent. Deliberately stricter
// than parseFloat — anything this rejects would either be rejected by Aster
// or, worse, silently reinterpreted.
const DECIMAL = /^\d+(\.\d+)?$/;
const DIGITS = /^\d+$/;
const ASSET = /^[A-Z0-9]{1,20}$/;

// Aster wants the nonce within ~10s of ITS clock; we only reject the wildly
// stale, so a slow user gets Aster's own clear error rather than ours.
const NONCE_SKEW_US = 120_000_000;

export type AsterWithdrawCheck =
  | { ok: true; fields: AsterWithdrawFields }
  | { ok: false; status: number; msg: string };

/**
 * Verifies a browser-produced withdrawal request end to end: both signatures
 * recover to `user`, and the Action one covers exactly the destination /
 * amount / fee / chain that are about to go on the wire.
 *
 * `query` must be the LITERAL string the browser signed — it is the signed
 * payload of signature 1, so it is forwarded byte for byte and must never be
 * rebuilt from parsed parts here.
 */
export function verifyAsterWithdrawRequest(query: unknown, signature: unknown): AsterWithdrawCheck {
  const bad = (status: number, msg: string): AsterWithdrawCheck => ({ ok: false, status, msg });

  if (typeof query !== 'string' || !query) return bad(400, 'query required');
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    return bad(400, 'signature required');

  const p = new URLSearchParams(query);
  if (p.has('signature')) return bad(400, 'query must not contain `signature` — it is appended last');

  const get = (k: string) => p.get(k) ?? '';
  const fields: AsterWithdrawFields = {
    chainId: get('chainId'),
    asset: get('asset'),
    amount: get('amount'),
    fee: get('fee'),
    receiver: get('receiver'),
    userNonce: get('userNonce'),
    signatureType: p.get('signatureType') ?? 'EOA',
    user: get('user'),
    nonce: get('nonce'),
  };
  const userSignature = get('userSignature');

  if (p.has('signer')) return bad(400, 'signer must be omitted — a withdrawal is authorized by the user, not an agent');
  if (!DIGITS.test(fields.chainId)) return bad(400, 'chainId required');
  if (!ASTER_CHAIN_SHORT_NAME[fields.chainId]) return bad(400, `Unsupported withdrawal chain ${fields.chainId}`);
  if (!ASSET.test(fields.asset)) return bad(400, 'asset required');
  if (!DECIMAL.test(fields.amount) || Number(fields.amount) <= 0) return bad(400, 'amount must be a positive token amount');
  if (!DECIMAL.test(fields.fee)) return bad(400, 'fee must be a plain decimal token amount');
  if (!isAddress(fields.receiver)) return bad(400, 'receiver must be an address');
  if (!isAddress(fields.user)) return bad(400, 'user must be an address');
  if (!DIGITS.test(fields.userNonce)) return bad(400, 'userNonce required');
  if (!DIGITS.test(fields.nonce)) return bad(400, 'nonce required');
  if (!/^0x[0-9a-fA-F]{130}$/.test(userSignature)) return bad(400, 'userSignature required');
  // SafeWallet signatures are ERC-1271, not ECDSA — nothing here could check
  // one, and forwarding an unverifiable authorization is exactly what this
  // function exists to prevent.
  if (fields.signatureType !== 'EOA') return bad(400, 'Only signatureType=EOA is supported');
  if (Math.abs(Date.now() * 1000 - Number(fields.nonce)) > NONCE_SKEW_US)
    return bad(400, 'nonce is stale — retry the withdrawal');

  let authSigner: string;
  try {
    authSigner = verifyTypedData(asterAuthDomain(), ASTER_AUTH_TYPES, { msg: query }, signature);
  } catch {
    return bad(401, 'Bad request signature');
  }
  if (authSigner.toLowerCase() !== fields.user.toLowerCase())
    return bad(403, 'Request signature does not match `user`');

  let actionSigner: string;
  try {
    actionSigner = verifyTypedData(
      asterWithdrawActionDomain(Number(fields.chainId)),
      ASTER_WITHDRAW_ACTION_TYPES,
      buildAsterWithdrawAction(fields),
      userSignature,
    );
  } catch {
    return bad(401, 'Bad withdrawal signature');
  }
  if (actionSigner.toLowerCase() !== fields.user.toLowerCase())
    return bad(403, 'Withdrawal signature does not authorize this destination, amount and fee');

  return { ok: true, fields };
}
