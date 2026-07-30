// The bytes the backend expects when it needs proof the caller controls the
// address they claim. THIS MUST MATCH backend/src/lib/wallet-auth.ts byte for
// byte — if the two drift, every withdrawal and every trading session fails
// with "Signature does not match".
//
// Its own file, with no imports, purely so `node lib/authMessage.test.ts` can
// run it: the rest of lib/wallet-auth.ts reaches into the wallet provider and
// can't be loaded outside a browser. Both sides of the format are now pinned
// by a test (here and backend/src/lib/wallet-auth.test.ts).
export function authMessage(
  action: string,
  user: string,
  params: Record<string, string>,
  timestamp: number,
): string {
  const body = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&');
  return [
    'RDO ONE authorization',
    `action: ${action}`,
    `user: ${user.toLowerCase()}`,
    `params: ${body}`,
    `timestamp: ${timestamp}`,
  ].join('\n');
}
