import { isAddress, verifyTypedData, type TypedDataField } from 'ethers';

// Aster V3 withdrawal — POST /fapi/v3/aster/user-withdraw.
//
// A withdrawal carries TWO EIP-712 signatures over two completely different
// domains. Keeping them apart is the whole job of this file:
//
//   1. the V3 auth wrapper  — domain AsterSignTransaction, chainId 1666,
//      Message{msg:string} where msg is the literal query string. Identical
//      to every other signed V3 call (src/lib/aster-auth.ts). Signed by THIS
//      USER'S OWN server-held agent key.
//   2. `userSignature`      — domain Aster, chainId of the DESTINATION chain,
//      an Action struct naming destination/token/amount/fee. Signed by the
//      USER'S WALLET. This is the actual authorization to move funds.
//
// Signature 1 used to be made in the browser too, and that made Aster
// withdrawals impossible for a large share of users: MetaMask refuses to sign
// a typed-data domain whose chainId isn't the connected chain, and Aster
// publishes no EVM RPC for 1666, so there was nothing to switch to. A live
// spike (docs/aster-withdrawal-findings.md) established that an agent
// registered `canWithdraw: true` signs that wrapper fine.
//
// WHY THE SERVER STILL CANNOT MOVE ANYONE'S FUNDS — this is measured, not
// assumed. The same spike tested an agent-signed Action and Aster REJECTED it
// with "Invalid signature. Please sign again." Signature 2 must come from the
// user's own key, and it binds destination, amount and fee. So the server can
// only ever carry a withdrawal the user has already authorized; it cannot
// originate one, and the agent keystore is not a hot wallet.
//
// That makes verifyAsterWithdrawAuthorization below load-bearing rather than
// ceremony: it is the check that the thing being forwarded really is a
// user-authorized withdrawal, for the user whose agent key is about to sign
// the wrapper. Without it the route is an open relay.

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
 *  docs/aster-withdrawal-findings.md.) */
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

export interface AsterWithdrawAuthorization {
  chainId: string;
  asset: string;
  amount: string;
  fee: string;
  receiver: string;
  userNonce: string;
  userSignature: string;
  user: string;
}

export type AsterWithdrawCheck =
  | { ok: true; fields: AsterWithdrawAuthorization }
  | { ok: false; status: number; msg: string };

/**
 * Verifies the ONE signature a withdrawal now carries from the browser: the
 * Action, domain `Aster` on the destination chain, binding destination /
 * token / amount / fee / nonce.
 *
 * The other signature — the V3 auth wrapper on domain chainId 1666 — is no
 * longer made here or in the browser. It is made by this user's own
 * server-held agent key at the moment of forwarding, because MetaMask refuses
 * to sign a typed-data domain whose chainId isn't the connected chain and
 * Aster publishes no RPC for 1666, so a large share of users simply could not
 * produce it. See spike RESULT.md: an agent registered `canWithdraw: true`
 * signs that wrapper fine.
 *
 * What makes that safe rather than a hot wallet is proven, not assumed: Aster
 * REJECTS an agent-signed Action with "Invalid signature. Please sign again."
 * The server therefore cannot originate a withdrawal — it can only carry one
 * the user has already authorized with their own key. This function is where
 * that authorization is checked, so it is the load-bearing part of the claim.
 *
 * `sessionUser` comes from the session cookie, never from the body: a wallet
 * address is public, and the agent key that will sign the wrapper is chosen by
 * it. The Action signature must recover to that same address.
 */
export function verifyAsterWithdrawAuthorization(body: unknown, sessionUser: string): AsterWithdrawCheck {
  const bad = (status: number, msg: string): AsterWithdrawCheck => ({ ok: false, status, msg });

  if (!body || typeof body !== 'object') return bad(400, 'body required');
  const b = body as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === 'string' ? (b[k] as string) : '');

  const fields: AsterWithdrawAuthorization = {
    chainId: str('chainId'),
    asset: str('asset'),
    amount: str('amount'),
    fee: str('fee'),
    receiver: str('receiver'),
    userNonce: str('userNonce'),
    userSignature: str('userSignature'),
    user: sessionUser,
  };

  if (!isAddress(sessionUser)) return bad(401, 'No session');
  if (!DIGITS.test(fields.chainId)) return bad(400, 'chainId required');
  if (!ASTER_CHAIN_SHORT_NAME[fields.chainId]) return bad(400, `Unsupported withdrawal chain ${fields.chainId}`);
  if (!ASSET.test(fields.asset)) return bad(400, 'asset required');
  if (!DECIMAL.test(fields.amount) || Number(fields.amount) <= 0) return bad(400, 'amount must be a positive token amount');
  if (!DECIMAL.test(fields.fee)) return bad(400, 'fee must be a plain decimal token amount');
  if (!isAddress(fields.receiver)) return bad(400, 'receiver must be an address');
  if (!DIGITS.test(fields.userNonce)) return bad(400, 'userNonce required');
  if (!/^0x[0-9a-fA-F]{130}$/.test(fields.userSignature)) return bad(400, 'userSignature required');
  // Aster wants the userNonce within its own window; only the wildly stale is
  // rejected here so a slow user gets Aster's clearer error instead of ours.
  if (Math.abs(Date.now() * 1000 - Number(fields.userNonce)) > NONCE_SKEW_US)
    return bad(400, 'userNonce is stale — retry the withdrawal');

  let actionSigner: string;
  try {
    actionSigner = verifyTypedData(
      asterWithdrawActionDomain(Number(fields.chainId)),
      ASTER_WITHDRAW_ACTION_TYPES,
      buildAsterWithdrawAction(fields),
      fields.userSignature,
    );
  } catch {
    // 400, not 401: the frontend's asterFetch treats 401 as "session expired"
    // and reacts by dropping the session and re-prompting the wallet. Reserving
    // 401 for a genuinely missing session keeps an unparseable signature from
    // sending the user through a pointless re-authentication that cannot fix it.
    return bad(400, 'Bad withdrawal signature');
  }
  // SafeWallet signatures are ERC-1271, not ECDSA — verifyTypedData cannot
  // check one, so they fail here rather than being forwarded unverified.
  if (actionSigner.toLowerCase() !== sessionUser.toLowerCase())
    return bad(403, 'Withdrawal signature does not authorize this destination, amount and fee');

  return { ok: true, fields };
}

/**
 * The params the agent key signs and Aster receives. `signer`, `nonce` and the
 * wrapper `signature` are appended by signAsterV3RequestAs — deliberately not
 * here, so there is exactly one place that decides what an agent-signed V3
 * request looks like.
 *
 * `signatureType` stays 'EOA' and describes the USER's Action signature, not
 * the wrapper. The spike found Aster accepts 'AGENT' here too with an
 * identical signer arrangement, i.e. the field is not load-bearing — so it
 * keeps the value whose meaning we can actually justify.
 */
export function asterWithdrawParams(f: AsterWithdrawAuthorization): Record<string, string> {
  return {
    chainId: f.chainId,
    asset: f.asset,
    amount: f.amount,
    fee: f.fee,
    receiver: f.receiver,
    userNonce: f.userNonce,
    userSignature: f.userSignature,
    signatureType: 'EOA',
    user: f.user,
  };
}
