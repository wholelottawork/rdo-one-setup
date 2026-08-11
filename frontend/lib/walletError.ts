// Turning wallet/RPC exceptions into one line a human can act on.
//
// ethers v6 serializes the ENTIRE failed RPC payload into `error.message` —
// request params, the provider's nested cause, and a chrome-extension stack
// trace. Piped straight to a toast (which is what every catch block used to
// do) the user gets several hundred characters of JSON for what is usually
// "you clicked reject".

/** Text that has no business reaching a user, however it got here. */
function isGarbage(s: string): boolean {
  return !s
    || s.length > 160
    || s.includes('chrome-extension://')
    || s.includes('\n    at ')
    || /could not coalesce|jsonrpc|"payload"|\{\s*"/i.test(s);
}

function pick(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === 'string' && v.trim()) return v.trim();
  return '';
}

export function walletErrorMessage(e: unknown, fallback = 'Transaction failed'): string {
  // Errors we wrote ourselves are already user-facing. Matched by name rather
  // than `instanceof HlAgentError` so this module imports nothing — it has to
  // stay usable from the plain-node test runner and from any catch block.
  if (e instanceof Error && e.name === 'HlAgentError') return e.message;
  if (typeof e === 'string') return isGarbage(e) ? fallback : e;
  if (!e || typeof e !== 'object') return fallback;

  const err = e as Record<string, any>;

  // The real provider error hides at a different depth depending on whether
  // it came from the injected wallet, ethers' wrapper, or WalletConnect.
  const inner  = err.info?.error ?? err.error ?? err.cause ?? {};
  const codes  = [err.code, inner.code, inner.cause?.code];
  const numeric = codes.find((c) => typeof c === 'number');

  // EIP-1193 / EIP-1474 codes — the only fully reliable signal here.
  switch (numeric) {
    case 4001:   return 'Signature rejected in wallet';
    case 4100:   return 'Wallet has not authorized this account — unlock it and reconnect';
    case 4900:
    case 4901:   return 'Wallet is disconnected — reconnect and try again';
    case -32002: return 'A wallet request is already open — finish it in your wallet first';
    case -32000: return 'Wallet rejected the request — check your balance and network';
  }
  if (err.code === 'ACTION_REJECTED')    return 'Signature rejected in wallet';
  if (err.code === 'INSUFFICIENT_FUNDS') return 'Not enough ETH to cover gas';
  if (err.code === 'NETWORK_ERROR')      return 'Network error — check your connection and retry';
  if (err.code === 'TIMEOUT')            return 'Request timed out — retry';

  const text = pick(
    inner.cause?.message,
    inner.message,
    err.shortMessage,
    err.message,
  );

  // Should be unreachable now that L1 actions are signed by the agent wallet
  // (lib/hl-agent.ts) rather than the user's, but a stray domain mismatch is
  // worth naming precisely instead of dumping the raw provider text.
  if (/must match the active chain/i.test(text))
    return 'Wallet is on the wrong network for this signature';
  if (/user (rejected|denied)|rejected the request|action_rejected/i.test(text))
    return 'Signature rejected in wallet';
  if (/insufficient funds/i.test(text))
    return 'Not enough ETH to cover gas';
  if (/failed to fetch|network ?error|econnrefused/i.test(text))
    return 'Network error — check your connection and retry';

  return isGarbage(text) ? fallback : text;
}
