/**
 * Redaction for anything that leaves this process as text — every log line
 * that describes a request, a money route, or an error.
 *
 * This is not defence in depth, it is THE defence. Container logs are read by
 * whoever can run `docker compose logs`, shipped to disk under
 * /var/lib/docker, and rotated rather than deleted — a secret that reaches
 * them is a secret that persists. And the values at stake here are not debug
 * noise: `userSignature` plus its query string IS a withdrawal that Aster will
 * replay until the nonce ages out, `rdo_sess` IS a trading session, and
 * AGENT_KEY_ENCRYPTION_SECRET decrypts every stored agent key in Redis.
 *
 * The rule is deny-by-default on SHAPE, not just on name:
 *
 *   1. exact/substring key names (case-insensitive), and
 *   2. any VALUE that looks like key material — 64 hex chars (private keys,
 *      session ids, the encryption secret) or a 65-byte ECDSA signature —
 *      whatever key it arrived under, including inside free text.
 *
 * Rule 2 is what catches the cases nobody thought to name: an error message
 * that interpolated a signature, a signed Aster URL logged as `req.url`, a log
 * line built by string concatenation somewhere upstream of here. pino's own
 * `redact` (configured in src/index.ts) only does rule 1, on fixed paths —
 * which is why it is the backstop here and not the mechanism.
 */

/** Redacted values are replaced with this, never dropped — a missing field
 *  reads as "the code didn't set it", which sends you debugging the wrong
 *  thing. `[redacted]` says the value existed and we refused to ship it. */
export const REDACTED = '[redacted]';

/**
 * Key names whose VALUE is always secret. Matched case-insensitively against
 * the key with separators removed, so one entry covers every spelling the
 * codebase and its upstreams actually use: `apiKey`, `API_KEY`, `api-key` and
 * the `X-MBX-APIKEY` header all normalize to `apikey`.
 *
 * Separator-stripping is not cosmetic. Without it `API_KEY` sails straight
 * through a list containing `apikey`, which is the sort of near-miss that
 * makes a redactor worse than none — it looks like coverage.
 */
const SECRET_KEY_PARTS = [
  'apikey',
  'apisecret',
  'signature',      // also catches `userSignature`, `signatureType`
  'privatekey',
  'agentkey',
  'secret',         // AGENT_KEY_ENCRYPTION_SECRET, secretbox, …
  'password',
  'passwd',
  'mnemonic',
  'seedphrase',
  'authorization',
  'cookie',         // Cookie, Set-Cookie, cookies
  'listenkey',      // Aster user-data-stream key — account-scoped bearer
  'token',
];

/** Exact names that are too short to substring-match without eating innocent
 *  fields (`key` would swallow `cacheKey`, `sk` would swallow `risk`). */
const SECRET_KEY_EXACT = new Set(['sig', 'key', 'auth', 'pk', 'sk']);

/** Lowercase and drop `-`, `_` and spaces, so one list entry covers every
 *  casing/separator spelling of the same name. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

export function isSecretKey(key: string): boolean {
  const k = normalizeKey(key);
  if (SECRET_KEY_EXACT.has(k)) return true;
  return SECRET_KEY_PARTS.some((part) => k.includes(part));
}

/**
 * Value shapes that are secret regardless of the key they arrived under.
 *
 * - `0x` + 130 hex = a 65-byte ECDSA signature. Two of these are a withdrawal.
 * - 64 hex chars (with or without `0x`) = a private key, an agent key, a
 *   session id, or AGENT_KEY_ENCRYPTION_SECRET. All fatal.
 *
 * The boundaries are deliberately `\b`-ish rather than anchored: these have to
 * fire on a value embedded in a sentence ("Bad signature 0xabc…"), which is
 * exactly how they escape into error messages.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /0x[0-9a-fA-F]{130}/g,                    // ECDSA signature (checked first — longest)
  /(?<![0-9a-fA-F])(?:0x)?[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, // 32-byte key material
];

/** Replaces secret-shaped substrings inside a string, leaving the rest
 *  readable — an error message with its signature blanked is still useful. */
export function scrubString(value: string): string {
  let out = value;
  for (const re of SECRET_VALUE_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

/**
 * Routes whose REQUEST BODY is secret in its entirety — there is no safe
 * subset to keep, so the body is replaced wholesale rather than walked.
 *
 * `/aster-withdraw` is the sharpest: its body is two signatures that together
 * are a live, replayable withdrawal. `/aster-session` carries the signature
 * that mints a session cookie. `/aster-signed/*` bodies are signed order
 * payloads. `/aster-creds` no longer exists but is listed so a revival cannot
 * quietly land outside this net.
 */
const SECRET_BODY_PATHS = [
  '/aster-withdraw',
  '/aster-session',
  '/aster-creds',
  '/aster-signed',
  '/aster-approve-agent',
  '/aster-agent-address',
];

export function isSecretBodyPath(pathOrUrl: string | undefined): boolean {
  if (!pathOrUrl) return false;
  // Compare on the path only: a query string can contain anything, and the
  // caller may hand us a full URL or a bare path.
  const path = pathOrUrl.split('?')[0].toLowerCase();
  return SECRET_BODY_PATHS.some((p) => path.includes(p));
}

/**
 * Depth- and breadth-bounded so a cyclic or pathological object cannot turn a
 * log line into a hang. Truncation returns REDACTED, i.e. it fails closed: an
 * over-deep object loses readability, never containment.
 */
const MAX_DEPTH = 12;
const MAX_KEYS = 500;

/**
 * Deep-copy `value` with every secret key's value and every secret-shaped
 * string replaced. Returns a NEW structure — the caller's object (which may
 * be a live request body) is never mutated.
 */
export function scrubDeep<T>(value: T, depth = 0): T {
  if (value == null) return value;
  if (typeof value === 'string') return scrubString(value) as unknown as T;
  if (typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return REDACTED as unknown as T;

  if (Array.isArray(value)) {
    return value.slice(0, MAX_KEYS).map((v) => scrubDeep(v, depth + 1)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  let seen = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (seen++ >= MAX_KEYS) break;
    out[k] = isSecretKey(k) ? REDACTED : scrubDeep(v, depth + 1);
  }
  return out as unknown as T;
}

/** Strips the query string's secret params while keeping the path readable —
 *  a signed Aster URL is otherwise a complete credential in the event title. */
export function scrubUrl(url: string): string {
  const [base, qs] = url.split('?');
  if (!qs) return scrubString(base);
  const params = new URLSearchParams(qs);
  for (const key of [...params.keys()]) {
    if (isSecretKey(key)) params.set(key, REDACTED);
    else params.set(key, scrubString(params.get(key) ?? ''));
  }
  return `${scrubString(base)}?${params.toString()}`;
}
