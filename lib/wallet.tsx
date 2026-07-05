'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
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
  connect: () => Promise<string | null>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const showToast = useToast();

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
      return accounts[0];
    } catch {
      showToast('Connection rejected', 'err');
      return null;
    } finally {
      setIsConnecting(false);
    }
  }, [showToast]);

  const disconnect = useCallback(() => setAddress(null), []);

  const value = useMemo(
    () => ({ address, isConnecting, connect, disconnect }),
    [address, isConnecting, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
