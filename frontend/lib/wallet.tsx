'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { showToast } from './toast';
import { clearAsterSession } from './aster-session';

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

// The provider the user actually PICKED. Every signing path in the app —
// orderFlow's HL signer, aster-agent's approveAgent, the transfer page's
// withdrawals, NetworkSwitcher's chain switch — resolves its provider through
// getEVMProvider(), so setting this one variable on connect routes all of them
// at the chosen wallet. That includes WalletConnect, which isn't injected at
// all and can't be found by sniffing `window`.
let activeProvider: EIP1193Provider | null = null;

export function getEVMProvider(): EIP1193Provider | null {
  if (activeProvider) return activeProvider;
  if (typeof window === 'undefined') return null;
  return window.phantom?.ethereum ?? window.ethereum ?? null;
}

export type WalletId = 'metamask' | 'rabby' | 'phantom' | 'coinbase' | 'injected' | 'walletconnect';

export interface WalletOption {
  id: WalletId;
  name: string;
  provider: EIP1193Provider | null;
  /** WalletConnect is always offerable (it's a QR, not an extension). */
  available: boolean;
}

type InjectedProvider = EIP1193Provider & {
  isMetaMask?: boolean;
  isRabby?: boolean;
  isPhantom?: boolean;
  isCoinbaseWallet?: boolean;
};

/** Every injected EIP-1193 provider on the page, de-duplicated. Multiple
 *  extensions coexist under `window.ethereum.providers`; Phantom and Coinbase
 *  also expose their own namespaces. */
function injectedProviders(): InjectedProvider[] {
  if (typeof window === 'undefined') return [];
  const w = window as typeof window & {
    coinbaseWalletExtension?: InjectedProvider;
  };
  const out: InjectedProvider[] = [];
  const add = (p?: InjectedProvider | null) => { if (p && !out.includes(p)) out.push(p); };
  if (Array.isArray(w.ethereum?.providers)) (w.ethereum.providers as InjectedProvider[]).forEach(add);
  else add(w.ethereum as InjectedProvider | undefined);
  add(w.phantom?.ethereum as InjectedProvider | undefined);
  add(w.coinbaseWalletExtension);
  return out;
}

const WC_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

/** What the connect modal should offer, in display order. */
export function listWallets(): WalletOption[] {
  const found = injectedProviders();
  const pick = (fn: (p: InjectedProvider) => boolean | undefined) => found.find((p) => fn(p)) ?? null;
  const metamask = pick((p) => p.isMetaMask && !p.isRabby && !p.isPhantom);
  const rabby = pick((p) => p.isRabby);
  const phantom = pick((p) => p.isPhantom);
  const coinbase = pick((p) => p.isCoinbaseWallet);
  // Anything present but unrecognised still deserves an entry — a working
  // wallet the app can't name is better than no option at all.
  const other = found.find((p) => p !== metamask && p !== rabby && p !== phantom && p !== coinbase) ?? null;

  const options: WalletOption[] = [
    { id: 'metamask', name: 'MetaMask', provider: metamask, available: !!metamask },
    { id: 'rabby', name: 'Rabby', provider: rabby, available: !!rabby },
    { id: 'phantom', name: 'Phantom', provider: phantom, available: !!phantom },
    { id: 'coinbase', name: 'Coinbase Wallet', provider: coinbase, available: !!coinbase },
    { id: 'injected', name: 'Browser wallet', provider: other, available: !!other },
    // No projectId configured means no WalletConnect relay to talk to, so the
    // option is hidden rather than shown broken.
    { id: 'walletconnect', name: 'WalletConnect (mobile)', provider: null, available: !!WC_PROJECT_ID },
  ];
  return options.filter((o) => o.available);
}

let wcProvider: (EIP1193Provider & { enable?: () => Promise<string[]>; disconnect?: () => Promise<void>; session?: unknown }) | null = null;

/** Lazily builds the WalletConnect v2 provider. It implements the same
 *  EIP-1193 surface as an injected wallet, so once it's the activeProvider
 *  every existing eth_signTypedData_v4 / eth_sendTransaction call works
 *  unchanged. */
async function getWalletConnectProvider() {
  if (wcProvider) return wcProvider;
  if (!WC_PROJECT_ID) throw new Error('WalletConnect is not configured — set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID');
  const { EthereumProvider } = await import('@walletconnect/ethereum-provider');
  wcProvider = (await EthereumProvider.init({
    projectId: WC_PROJECT_ID,
    // Arbitrum is where HL settles; the rest are what the transfer page offers.
    chains: [42161],
    optionalChains: [1, 56, 8453, 10, 137, 43114],
    showQrModal: true,
  })) as unknown as typeof wcProvider;
  return wcProvider;
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
  connectWith: (id: WalletId) => Promise<void>;
  wallets: WalletOption[];
  disconnect: () => void;
}

const WalletContext = createContext<WalletContextValue | null>(null);

const EVM_LS_KEY = 'rdo_evm_address';
const SOL_LS_KEY = 'rdo_sol_address';
const WALLET_LS_KEY = 'rdo_wallet_id';
// Explicit disconnect has to be remembered. The extension stays authorized
// after one, so `eth_accounts` keeps returning the address and the mount
// effect below would silently reconnect a user who deliberately left.
const DISCONNECTED_LS_KEY = 'rdo_disconnected';

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
    // A user who disconnected stays disconnected across reloads, until they
    // explicitly connect again.
    try {
      if (localStorage.getItem(DISCONNECTED_LS_KEY)) {
        localStorage.removeItem(EVM_LS_KEY);
        localStorage.removeItem(SOL_LS_KEY);
        setChecked(true);
        return;
      }
    } catch { /* silent */ }

    try {
      const storedEvm = localStorage.getItem(EVM_LS_KEY);
      if (storedEvm) setEvmAddress(storedEvm);
      const storedSol = localStorage.getItem(SOL_LS_KEY);
      if (storedSol) setSolAddress(storedSol);
      // Re-point the shared accessor at the wallet that was in use, so signing
      // after a reload goes to the same place it did before it.
      const storedId = localStorage.getItem(WALLET_LS_KEY) as WalletId | null;
      if (storedId && storedId !== 'walletconnect') {
        const match = listWallets().find((w) => w.id === storedId);
        if (match?.provider) activeProvider = match.provider;
      } else if (storedId === 'walletconnect') {
        // WC sessions live in the provider's own storage; re-init and adopt
        // the session if it's still alive.
        getWalletConnectProvider()
          .then(async (p) => {
            if (cancelled || !p?.session) return;
            activeProvider = p;
            const accs = (await p.request({ method: 'eth_accounts' })) as string[];
            if (accs?.[0] && !cancelled) setEvmAddress(accs[0]);
          })
          .catch(() => { /* no live session */ });
      }
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
      // Whatever the new account is, the Aster session belongs to the old one.
      clearAsterSession();
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

  /** Connect one specific wallet from the chooser. */
  const connectWith = useCallback(async (id: WalletId) => {
    setIsConnecting(true);
    try {
      let provider: EIP1193Provider | null = null;
      if (id === 'walletconnect') {
        const p = await getWalletConnectProvider();
        await p!.enable?.();
        provider = p!;
      } else {
        provider = listWallets().find((w) => w.id === id)?.provider ?? null;
      }
      if (!provider) throw new Error('That wallet is no longer available');

      const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as string[];
      if (!accounts?.[0]) throw new Error('Connection rejected');
      activeProvider = provider;
      setEvmAddress(accounts[0]);
      try {
        localStorage.setItem(EVM_LS_KEY, accounts[0]);
        localStorage.setItem(WALLET_LS_KEY, id);
        localStorage.removeItem(DISCONNECTED_LS_KEY);
      } catch { /* silent */ }

      // Phantom exposes Solana from the same approval — take it if offered,
      // but never let a Solana refusal undo a good EVM connection.
      if (id === 'phantom') {
        try {
          const resp = await getSolanaProvider()?.connect();
          const addr = resp?.publicKey?.toString();
          if (addr) {
            setSolAddress(addr);
            try { localStorage.setItem(SOL_LS_KEY, addr); } catch { /* silent */ }
          }
        } catch { /* EVM half already succeeded */ }
      }
    } catch (e) {
      showToast((e as Error)?.message ?? 'Connection failed', 'err');
    } finally {
      setIsConnecting(false);
    }
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
            activeProvider = evmProvider;
            setEvmAddress(accounts[0]);
            try {
              localStorage.setItem(EVM_LS_KEY, accounts[0]);
              localStorage.removeItem(DISCONNECTED_LS_KEY);
            } catch { /* silent */ }
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
            try {
              localStorage.setItem(SOL_LS_KEY, addr);
              localStorage.removeItem(DISCONNECTED_LS_KEY);
            } catch { /* silent */ }
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
    // A WalletConnect session outlives the page unless it's explicitly killed,
    // so "disconnect" that only cleared local state would leave the pairing up.
    if (wcProvider && activeProvider === wcProvider) {
      wcProvider.disconnect?.().catch(() => { /* silent */ });
      wcProvider = null;
    }
    activeProvider = null;
    // The Aster trading session outlives the page too — leaving it live would
    // mean "disconnected" in the UI while the backend still trades on request.
    clearAsterSession();
    setEvmAddress(null);
    setSolAddress(null);
    try {
      localStorage.removeItem(EVM_LS_KEY);
      localStorage.removeItem(SOL_LS_KEY);
      localStorage.removeItem(WALLET_LS_KEY);
      localStorage.setItem(DISCONNECTED_LS_KEY, '1');
    } catch { /* silent */ }
  }, []);

  // Recomputed per render rather than stored: extensions inject asynchronously,
  // so a list captured once at mount can miss a wallet that loaded late.
  const wallets = typeof window === 'undefined' ? [] : listWallets();

  const value = useMemo(
    () => ({ evmAddress, solAddress, isConnecting, checked, connect, connectWith, wallets, disconnect }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [evmAddress, solAddress, isConnecting, checked, connect, connectWith, disconnect, wallets.length],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error('useWallet must be used within WalletProvider');
  return ctx;
}
