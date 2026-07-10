'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useToast } from './toast';

interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
    phantom?: { ethereum?: EIP1193Provider; solana?: unknown };
  }
}

export function getEVMProvider(): EIP1193Provider | null {
  if (typeof window === 'undefined') return null;
  return window.phantom?.ethereum ?? window.ethereum ?? null;
}

/**
 * Picks an EVM provider that can actually switch to BNB Smart Chain for
 * `expectedAddress` — needed because Phantom's EVM mode has a hardcoded
 * chain allowlist (Ethereum, Base, Polygon, Monad testnet — confirmed
 * against Phantom's own docs/help center) that does NOT include BSC.
 * wallet_switchEthereumChain AND wallet_addEthereumChain both fail for
 * Phantom + BSC; there's no request payload that works around it, it's a
 * capability gap, not a formatting bug. Aster's approveAgent signature is
 * hardcoded to require chainId 56, so if Phantom is the active wallet and
 * another injected wallet (e.g. MetaMask) already has the SAME address
 * connected, prefer that one for this specific signature — checked via
 * eth_accounts, which never prompts, so this never surprises the user with
 * an unexpected connection request. Falls back to whatever's available
 * (typically Phantom) if no matching alternative exists, so the caller can
 * still surface a clear, specific error instead of a silent failure.
 */
export async function getBscCapableProvider(expectedAddress: string): Promise<EIP1193Provider | null> {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { ethereum?: (EIP1193Provider & { providers?: EIP1193Provider[]; isPhantom?: boolean }); phantom?: { ethereum?: EIP1193Provider & { isPhantom?: boolean } } };
  const candidates: (EIP1193Provider & { isPhantom?: boolean })[] = [];
  if (Array.isArray(w.ethereum?.providers)) candidates.push(...(w.ethereum.providers as (EIP1193Provider & { isPhantom?: boolean })[]));
  else if (w.ethereum) candidates.push(w.ethereum);
  if (w.phantom?.ethereum && !candidates.includes(w.phantom.ethereum)) candidates.push(w.phantom.ethereum);

  const nonPhantom = candidates.filter((p) => !p.isPhantom);
  for (const p of nonPhantom) {
    try {
      const accounts = (await p.request({ method: 'eth_accounts' })) as string[];
      if (accounts?.some((a) => a.toLowerCase() === expectedAddress.toLowerCase())) return p;
    } catch { /* try the next candidate */ }
  }
  return candidates[0] ?? null;
}

export function getSolanaProvider(): unknown | null {
  if (typeof window === 'undefined') return null;
  return window.phantom?.solana ?? null;
}

interface WalletContextValue {
  address: string | null;
  isConnecting: boolean;
  checked: boolean;
  connect: () => Promise<string | null>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const LS_KEY = 'wallet_address';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Start null so the first client render matches the server's (which has no
  // localStorage) — reading the stored address in the useState initializer
  // instead would make the initial client tree differ from the SSR HTML and
  // trigger a hydration mismatch. The stored address is restored in the mount
  // effect below (client-only), one frame later.
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [checked, setChecked] = useState(false);
  const showToast = useToast();

  // On mount (client only): optimistically restore the last-known address for
  // an instant repaint, then verify against the wallet — in case the user
  // disconnected outside the app — clearing it if no account is authorized.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) setAddress(stored);
    } catch { /* silent */ }

    const provider = getEVMProvider();
    if (!provider) {
      setChecked(true);
      return;
    }
    provider.request({ method: 'eth_accounts' }).then((accounts) => {
      const accs = accounts as string[];
      if (accs?.[0]) {
        setAddress(accs[0]);
        try { localStorage.setItem(LS_KEY, accs[0]); } catch { /* silent */ }
      } else {
        setAddress(null);
        try { localStorage.removeItem(LS_KEY); } catch { /* silent */ }
      }
    }).catch(() => { /* silent */ }).finally(() => setChecked(true));
  }, []);

  const connect = useCallback(async () => {
    const provider = getEVMProvider();
    if (!provider) {
      showToast('No wallet found — install Phantom at phantom.app', 'err');
      return null;
    }

    setIsConnecting(true);
    try {
      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      setAddress(accounts[0]);
      try { localStorage.setItem(LS_KEY, accounts[0]); } catch { /* silent */ }
      return accounts[0];
    } catch {
      showToast('Connection rejected', 'err');
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [showToast]);

  const disconnect = useCallback(() => {
    setAddress(null);
    try { localStorage.removeItem(LS_KEY); } catch { /* silent */ }
  }, []);

  const value = useMemo(
    () => ({ address, isConnecting, checked, connect, disconnect }),
    [address, isConnecting, checked, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
