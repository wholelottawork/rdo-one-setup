'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { showToast } from './toast';

interface EIP1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
}

interface PhantomSolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
}

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { providers?: EIP1193Provider[]; isPhantom?: boolean };
    phantom?: { ethereum?: EIP1193Provider & { isPhantom?: boolean }; solana?: PhantomSolanaProvider };
    solana?: PhantomSolanaProvider;
  }
}

export function getEVMProvider(): EIP1193Provider | null {
  if (typeof window === 'undefined') return null;
  return window.phantom?.ethereum ?? window.ethereum ?? null;
}

export function getSolanaProvider(): PhantomSolanaProvider | null {
  if (typeof window === 'undefined') return null;
  return window.phantom?.solana ?? window.solana ?? null;
}

export interface EvmNetworkOption {
  chainId: string; // hex for EVM chains (e.g. '0x38'), or the literal 'solana'
  name: string;
  short: string; // small badge glyph for the nav chip
  color: string;
  bg: string;
  icon: string; // chain icon URL (shown in place of text)
  nativeCurrency?: { name: string; symbol: string; decimals: number };
  rpcUrls?: string[];
  blockExplorerUrls?: string[];
}

// Matches the network switcher on Aster's own site (asterdex.com) — BNB
// Chain / Ethereum / Arbitrum / Solana in one list. Solana has no
// chainId/RPC/wallet_switchEthereumChain equivalent — selecting it in the
// nav just changes which of evmAddress/solAddress the address chip shows,
// there's no "switch" request to make. BNB Chain is listed first since
// it's this app's most common target (Aster's approveAgent signature).
export const EVM_NETWORKS: EvmNetworkOption[] = [
  { chainId: '0x38', name: 'BNB Chain', short: 'B', color: '#F0B90B', bg: '#3a2f0a', icon: 'https://cryptologos.cc/logos/bnb-bnb-logo.png', nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 }, rpcUrls: ['https://bsc-dataseed.binance.org/'], blockExplorerUrls: ['https://bscscan.com'] },
  { chainId: '0x1', name: 'Ethereum', short: 'Ξ', color: '#627EEA', bg: '#1b2429', icon: 'https://cryptologos.cc/logos/ethereum-eth-logo.png', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://eth.llamarpc.com'], blockExplorerUrls: ['https://etherscan.io'] },
  { chainId: '0xa4b1', name: 'Arbitrum', short: 'A', color: '#28A0F0', bg: '#0f2a3d', icon: 'https://cryptologos.cc/logos/arbitrum-arb-logo.png', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: ['https://arb1.arbitrum.io/rpc'], blockExplorerUrls: ['https://arbiscan.io'] },
  { chainId: 'solana', name: 'Solana', short: 'S', color: '#9945FF', bg: '#241a3d', icon: 'https://cryptologos.cc/logos/solana-sol-logo.png' },
];

/**
 * Picks an EVM provider that can actually switch to `chainId` for
 * `expectedAddress` — needed because Phantom's EVM mode has a hardcoded
 * chain allowlist (Ethereum, Base, Polygon, Monad testnet — confirmed
 * against Phantom's own docs/help center) that does NOT include BNB Chain
 * or Arbitrum. wallet_switchEthereumChain AND wallet_addEthereumChain both
 * fail for Phantom on those; there's no request payload that works around
 * it, it's a capability gap, not a formatting bug. If Phantom is the active
 * wallet and another injected wallet (e.g. MetaMask) already has the SAME
 * address connected, prefer that one instead — checked via eth_accounts,
 * which never prompts, so this never surprises the user with an unexpected
 * connection request. Falls back to whatever's available (typically
 * Phantom) if no matching alternative exists, so the caller can still
 * surface a clear, specific error instead of a silent failure. Ethereum
 * mainnet is one of the few chains Phantom natively supports, so it's
 * exempted from the swap.
 */
export async function getEvmProviderFor(expectedAddress: string, chainId: string): Promise<EIP1193Provider | null> {
  if (typeof window === 'undefined') return null;
  const w = window;
  const candidates: (EIP1193Provider & { isPhantom?: boolean })[] = [];
  if (Array.isArray(w.ethereum?.providers)) candidates.push(...(w.ethereum.providers as (EIP1193Provider & { isPhantom?: boolean })[]));
  else if (w.ethereum) candidates.push(w.ethereum);
  if (w.phantom?.ethereum && !candidates.includes(w.phantom.ethereum)) candidates.push(w.phantom.ethereum);

  if (chainId === '0x1') return candidates[0] ?? null;

  const nonPhantom = candidates.filter((p) => !p.isPhantom);
  for (const p of nonPhantom) {
    try {
      const accounts = (await p.request({ method: 'eth_accounts' })) as string[];
      if (accounts?.some((a) => a.toLowerCase() === expectedAddress.toLowerCase())) return p;
    } catch { /* try the next candidate */ }
  }
  return candidates[0] ?? null;
}

/** Switch (or add, if not present) `provider` to `network` — the shared
 *  switch/add/error-message logic behind both the network switcher UI and
 *  ensureBscNetwork below. */
export async function switchEvmNetwork(provider: EIP1193Provider, network: EvmNetworkOption): Promise<{ ok: boolean; reason?: string }> {
  const isPhantom = (provider as { isPhantom?: boolean })?.isPhantom;
  const unsupportedMsg = isPhantom
    ? `Phantom doesn't support ${network.name} — connect with MetaMask (or another EVM wallet) instead.`
    : `Your wallet couldn't switch to ${network.name}.`;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: network.chainId }] });
    return { ok: true };
  } catch (e) {
    const code = (e as { code?: number })?.code;
    if (code === 4902) {
      try {
        await provider.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: network.chainId,
            chainName: network.name,
            nativeCurrency: network.nativeCurrency,
            rpcUrls: network.rpcUrls,
            blockExplorerUrls: network.blockExplorerUrls,
          }],
        });
        return { ok: true };
      } catch {
        return { ok: false, reason: unsupportedMsg };
      }
    }
    return { ok: false, reason: unsupportedMsg };
  }
}

/** Thin BSC-specific wrapper — Aster's approveAgent signature requires this
 *  specific chain (see rdo-next/lib/aster-agent.ts's doc comments). */
export async function getBscCapableProvider(expectedAddress: string): Promise<EIP1193Provider | null> {
  return getEvmProviderFor(expectedAddress, '0x38');
}

export async function ensureBscNetwork(provider: EIP1193Provider): Promise<{ ok: boolean; reason?: string }> {
  return switchEvmNetwork(provider, EVM_NETWORKS[0]);
}

interface WalletContextValue {
  evmAddress: string | null;
  solAddress: string | null;
  isConnecting: boolean;
  checked: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const EVM_LS_KEY = 'rdo_evm_address';
const SOL_LS_KEY = 'rdo_sol_address';

/**
 * One connect action covers both chains (matches Aster's own site — see
 * the reference screenshot this was built from): clicking Connect in the
 * nav requests EVM accounts AND a Solana connection together when Phantom
 * is present, since Phantom natively exposes both from one approval. An
 * EVM-only wallet (no Phantom) just connects EVM; Solana-only UI (the
 * portfolio page's main asset view) degrades to "connect Phantom" rather
 * than blocking the rest of the app.
 *
 * Mounted ONCE at the root layout (rdo-next/app/layout.tsx) — every page
 * shares this same Context instance via real React state, not a
 * localStorage-simulated restore per page load.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  // Start null so the first client render matches the server's (no
  // localStorage there) — reading stored values in the useState initializer
  // instead would make the initial client tree differ from the SSR HTML and
  // trigger a hydration mismatch. Restored in the mount effect below.
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [solAddress, setSolAddress] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [checked, setChecked] = useState(false);

  // On mount (client only): optimistically restore the last-known addresses
  // for an instant repaint, then verify against the wallets — in case the
  // user disconnected outside the app — clearing whichever no longer
  // checks out.
  useEffect(() => {
    let cancelled = false;
    try {
      const storedEvm = localStorage.getItem(EVM_LS_KEY);
      if (storedEvm) setEvmAddress(storedEvm);
      const storedSol = localStorage.getItem(SOL_LS_KEY);
      if (storedSol) setSolAddress(storedSol);
    } catch { /* silent */ }

    const evmProvider = getEVMProvider();
    const solProvider = getSolanaProvider();

    const evmCheck = evmProvider
      ? evmProvider.request({ method: 'eth_accounts' }).then((accounts) => {
        if (cancelled) return;
        const accs = accounts as string[];
        if (accs?.[0]) {
          setEvmAddress(accs[0]);
          try { localStorage.setItem(EVM_LS_KEY, accs[0]); } catch { /* silent */ }
        } else {
          setEvmAddress(null);
          try { localStorage.removeItem(EVM_LS_KEY); } catch { /* silent */ }
        }
      }).catch(() => { /* silent */ })
      : Promise.resolve();

    const solCheck = solProvider
      ? solProvider.connect({ onlyIfTrusted: true }).then((resp) => {
        if (cancelled) return;
        const addr = resp?.publicKey?.toString();
        if (addr) {
          setSolAddress(addr);
          try { localStorage.setItem(SOL_LS_KEY, addr); } catch { /* silent */ }
        }
      }).catch(() => {
        if (cancelled) return;
        setSolAddress(null);
        try { localStorage.removeItem(SOL_LS_KEY); } catch { /* silent */ }
      })
      : Promise.resolve();

    Promise.all([evmCheck, solCheck]).finally(() => { if (!cancelled) setChecked(true); });

    // Keep in sync with wallet-side changes (account switch in the
    // extension, or disconnecting Phantom's Solana session directly).
    const onAccountsChanged = (accounts: unknown) => {
      const accs = accounts as string[];
      if (accs?.[0]) {
        setEvmAddress(accs[0]);
        try { localStorage.setItem(EVM_LS_KEY, accs[0]); } catch { /* silent */ }
      } else {
        setEvmAddress(null);
        try { localStorage.removeItem(EVM_LS_KEY); } catch { /* silent */ }
      }
    };
    const onSolDisconnect = () => {
      setSolAddress(null);
      try { localStorage.removeItem(SOL_LS_KEY); } catch { /* silent */ }
    };
    evmProvider?.on?.('accountsChanged', onAccountsChanged);
    solProvider?.on?.('disconnect', onSolDisconnect);

    return () => {
      cancelled = true;
      evmProvider?.removeListener?.('accountsChanged', onAccountsChanged);
      solProvider?.off?.('disconnect', onSolDisconnect);
    };
  }, []);

  const connect = useCallback(async () => {
    const evmProvider = getEVMProvider();
    const solProvider = getSolanaProvider();
    if (!evmProvider && !solProvider) {
      showToast('No wallet found — install Phantom or MetaMask', 'err');
      return;
    }

    setIsConnecting(true);
    let evmOk = false;
    let solOk = false;
    try {
      // Sequential, not parallel — overlapping eth_requestAccounts +
      // solana.connect() popups from the same extension can behave
      // unpredictably; one at a time is what every wallet actually expects.
      if (evmProvider) {
        try {
          const accounts = (await evmProvider.request({ method: 'eth_requestAccounts' })) as string[];
          if (accounts?.[0]) {
            setEvmAddress(accounts[0]);
            try { localStorage.setItem(EVM_LS_KEY, accounts[0]); } catch { /* silent */ }
            evmOk = true;
          }
        } catch { /* user rejected the EVM half — Solana may still succeed below */ }
      }
      if (solProvider) {
        try {
          const resp = await solProvider.connect();
          const addr = resp?.publicKey?.toString();
          if (addr) {
            setSolAddress(addr);
            try { localStorage.setItem(SOL_LS_KEY, addr); } catch { /* silent */ }
            solOk = true;
          }
        } catch { /* user rejected the Solana half */ }
      }
      if (!evmOk && !solOk) showToast('Connection rejected', 'err');
    } finally {
      setIsConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    getSolanaProvider()?.disconnect?.().catch(() => { /* silent */ });
    setEvmAddress(null);
    setSolAddress(null);
    try {
      localStorage.removeItem(EVM_LS_KEY);
      localStorage.removeItem(SOL_LS_KEY);
    } catch { /* silent */ }
  }, []);

  const value = useMemo(
    () => ({ evmAddress, solAddress, isConnecting, checked, connect, disconnect }),
    [evmAddress, solAddress, isConnecting, checked, connect, disconnect],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
