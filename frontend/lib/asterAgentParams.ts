// What the browser must bake into an Aster agent approval, read from the
// backend because it is deployment state: the server's whitelisted egress IP,
// and therefore whether this deployment can offer withdrawals at all.
//
// Deliberately dependency-free so it can be unit-tested on its own — the bug
// this guards against was invisible until a live withdrawal failed.

/**
 * One flat shape rather than a discriminated union: this project compiles with
 * `strict: false`, so `if (!p.ok)` does not narrow a `{ok:true}|{ok:false}`
 * union and every read of `message` becomes a type error. Keeping all fields
 * present on both outcomes means callers need no narrowing at all.
 *
 * On failure `canWithdraw` is false AND `ok` is false — callers must branch on
 * `ok`, because false-because-unknown is exactly the case that must not be
 * mistaken for false-because-configured.
 */
export interface AsterAgentParams {
  ok: boolean;
  ipWhitelist: string;
  canWithdraw: boolean;
  /** Why the lookup failed. Empty string when `ok`. */
  message: string;
}

const failed = (message: string): AsterAgentParams => ({
  ok: false,
  ipWhitelist: '',
  canWithdraw: false,
  message,
});

/**
 * FAILS CLOSED, and that is the whole point of the return shape.
 *
 * "The server says withdrawals are off" and "we could not ask the server" are
 * different answers and must not collapse into one. An Aster agent CANNOT be
 * amended through the API: mint it trade-only and it can never gain the flag,
 * so the user must notice, re-approve, and delete the dead agent by hand on
 * Aster's own page.
 *
 * This originally swallowed both cases into `canWithdraw: false`. The
 * /aster-agent-params rewrite was missing from next.config.js, so the lookup
 * 404'd and every approval quietly minted a trade-only agent — surfacing much
 * later as Aster's "Invalid API-key, IP, or permissions for action" at
 * withdrawal time, which points at Aster rather than at a missing proxy line.
 * A loud failure before the wallet prompt costs a retry; a silent one costs an
 * unamendable agent and a wasted signature.
 */
export async function fetchAsterAgentParams(): Promise<AsterAgentParams> {
  let res: Response;
  try {
    res = await fetch('/aster-agent-params');
  } catch {
    return failed('Could not reach the server to read Aster agent settings — check your connection and retry');
  }
  if (!res.ok)
    return failed(
      `Server did not return Aster agent settings (HTTP ${res.status}) — /aster-agent-params may not be proxied to the backend`,
    );
  let d: unknown;
  try {
    d = await res.json();
  } catch {
    return failed('Server returned malformed Aster agent settings');
  }
  const body = d as { ipWhitelist?: unknown; canWithdraw?: unknown };
  if (typeof body?.ipWhitelist !== 'string') return failed('Server returned malformed Aster agent settings');

  // An empty ipWhitelist is a VALID, deliberate answer: the deployment has no
  // static IP configured, so it cannot offer withdrawals and agents are minted
  // trade-only. Aster rejects canWithdraw without an IP regardless, so asking
  // for it anyway would fail the whole approval and take trading down with it.
  return {
    ok: true,
    ipWhitelist: body.ipWhitelist,
    canWithdraw: Boolean(body.canWithdraw) && Boolean(body.ipWhitelist),
    message: '',
  };
}
