import { connectedAddress, walletAuth } from './wallet-auth';

// Aster's signed routes used to take the account to act on straight from a
// `user` param the browser supplied — a public address, so anyone who could
// reach the backend could trade someone else's account. They're behind a
// session now: one wallet signature opens it, an HttpOnly cookie carries it,
// and the backend reads the address off that cookie and ignores anything the
// request claims. See backend/src/lib/aster-session.ts for why a session and
// not a per-request signature (short answer: prompt-free trading is the point
// of the agent approval, and these routes can't withdraw).
//
// Nothing here holds the token — the cookie is HttpOnly and this file couldn't
// read it if it wanted to. All it tracks is whether a session was established,
// so the wallet isn't prompted on every call.
let session: Promise<boolean> | null = null;

async function open(): Promise<boolean> {
  const user = await connectedAddress();
  if (!user) return false;

  // Reuse an existing session only if it belongs to the wallet that's
  // connected NOW. Switching accounts in the extension leaves the old
  // cookie in place, and trading the account someone just switched away
  // from is exactly the confusion this whole change is about.
  const existing = await fetch('/aster-session')
    .then(r => r.json())
    .catch(() => null);
  if (typeof existing?.user === 'string' && existing.user.toLowerCase() === user.toLowerCase()) return true;

  const auth = await walletAuth(user, 'aster-session');
  const res = await fetch('/aster-session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(auth),
  });
  return res.ok;
}

/** Establishes the trading session if there isn't one. Idempotent and shared:
 *  ten concurrent Aster calls on page load produce at most one prompt. */
export function ensureAsterSession(): Promise<boolean> {
  if (!session) {
    const attempt = open().catch(() => false);
    session = attempt;
    // A refusal (rejected signature, wallet not connected) must not be
    // remembered as a permanent no — the next attempt should ask again.
    // Only clear if this attempt is still the current one; a disconnect
    // mid-flight may already have replaced it.
    attempt.then(ok => { if (!ok && session === attempt) session = null; });
  }
  return session;
}

/** Drops the session — on disconnect, or when the wallet changes accounts.
 *  The cookie is the backend's to clear, so this has to be a round trip. */
export function clearAsterSession(): void {
  session = null;
  fetch('/aster-session', { method: 'DELETE' }).catch(() => { /* best effort */ });
}

/**
 * Every /aster-signed/* and /aster-tpsl-watch request goes through here — it
 * opens the session first, so a call that would otherwise 401 on a cold page
 * load just works.
 *
 * On these routes 401 means "no/expired session" and nothing else: Aster's own
 * rejections come back as a 200 carrying {code, msg}. So a 401 is proof the
 * request never reached the exchange, which is what makes retrying a POST
 * /order after re-signing safe rather than a way to double-fill.
 */
export async function asterFetch(url: string, init?: RequestInit): Promise<Response> {
  await ensureAsterSession();
  const res = await fetch(url, init);
  if (res.status !== 401) return res;

  session = null;
  if (!(await ensureAsterSession())) return res;
  return fetch(url, init);
}
