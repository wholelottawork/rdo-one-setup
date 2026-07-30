import { getEVMProvider } from './wallet';
import { authMessage } from './authMessage';

// One implementation of the signed-message format for the whole app — the
// transfer page used to carry its own copy, which made a third place for it
// to drift from the backend's. See ./authMessage.
export { authMessage };

export interface WalletAuth {
  user: string;
  timestamp: number;
  signature: string;
}

/** Prompts the wallet to authorize one specific action with one specific set
 *  of parameters. Send the whole returned object to the route. */
export async function walletAuth(
  user: string,
  action: string,
  params: Record<string, string> = {},
): Promise<WalletAuth> {
  const prov = getEVMProvider();
  if (!prov) throw new Error('Connect your wallet first.');
  const timestamp = Date.now();
  const signature = await prov.request({
    method: 'personal_sign',
    params: [authMessage(action, user, params, timestamp), user],
  }) as string;
  return { user, timestamp, signature };
}

/** The address the connected wallet is actually offering right now. */
export async function connectedAddress(): Promise<string | null> {
  const prov = getEVMProvider();
  if (!prov) return null;
  try {
    const accounts = await prov.request({ method: 'eth_accounts' }) as string[];
    return accounts?.[0] ?? null;
  } catch {
    return null;
  }
}
