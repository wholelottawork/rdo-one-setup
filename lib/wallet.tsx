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
