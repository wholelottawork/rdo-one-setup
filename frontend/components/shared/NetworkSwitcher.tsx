// Shared component — used by pages: Trade, Markets, News, Portfolio, Transfer (via WalletControls).
'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet, EVM_NETWORKS, getEVMProvider, type EvmNetworkOption } from '@/lib/wallet';

/**
 * The one network picker — same component everywhere a network needs to
 * be shown/picked (SiteNav's pages + the trade page's own header), so
 * switching behaves identically everywhere. Matches Aster's own site:
 * the picker is always visible (connected or not), and picking a
 * different network while connected logs the session out rather than
 * silently force-switching the wallet's chain in place — the caller's
 * own evmAddress/solAddress naturally clear once disconnect() runs.
 */
export function NetworkSwitcher({ onChange }: { onChange?: (network: EvmNetworkOption) => void }) {
  const { evmAddress, solAddress, disconnect } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [netOpen, setNetOpen] = useState(false);
  const [activeNetwork, setActiveNetworkState] = useState<EvmNetworkOption>(EVM_NETWORKS[1]); // Ethereum until detected otherwise
  const netRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  function setActiveNetwork(n: EvmNetworkOption) {
    setActiveNetworkState(n);
    onChange?.(n);
  }

  // Reflects the connected EVM wallet's REAL active chain, live — read
  // once, then follow chainChanged so switching (from here or anywhere
  // else, like Aster's approveAgent flow) never goes stale.
  useEffect(() => {
    if (!evmAddress) {
      if (!solAddress) return;
      setActiveNetwork(EVM_NETWORKS[3]); // only Solana connected
      return;
    }
    const provider = getEVMProvider();
    if (!provider) return;
    const onChainChanged = (chainIdHex: unknown) => {
      const found = EVM_NETWORKS.find(n => n.chainId.toLowerCase() === String(chainIdHex).toLowerCase());
      if (found) setActiveNetwork(found);
    };
    provider.request({ method: 'eth_chainId' }).then(onChainChanged).catch(() => { /* silent */ });
    provider.on?.('chainChanged', onChainChanged);
    return () => provider.removeListener?.('chainChanged', onChainChanged);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evmAddress, solAddress]);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (netOpen && netRef.current && !netRef.current.contains(e.target as Node)) setNetOpen(false);
    }
    document.addEventListener('click', onOutsideClick);
    return () => document.removeEventListener('click', onOutsideClick);
  }, [netOpen]);

  function pickNetwork(network: EvmNetworkOption) {
    setNetOpen(false);
    if (network.chainId === activeNetwork.chainId) return;
    setActiveNetwork(network);
    if (evmAddress || solAddress) disconnect();
  }

  if (!mounted) return null;

  return (
    <div className="net-switch-wrap" ref={netRef}>
      <button className="net-switch-btn" onClick={() => setNetOpen(o => !o)} title={activeNetwork.name}>
        <img
          src={activeNetwork.icon}
          alt={activeNetwork.name}
          width={18}
          height={18}
          style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        />
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {netOpen && (
        <div className="net-dropdown">
          {EVM_NETWORKS.map(n => (
            <button key={n.chainId} className="net-option" onClick={() => pickNetwork(n)} title={n.name}>
              <img
                src={n.icon}
                alt={n.name}
                width={18}
                height={18}
                style={{ borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
              />
              {activeNetwork.chainId === n.chainId && <span className="net-opt-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
