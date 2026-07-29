// Shared component — used by pages: Trade, Markets, News, Portfolio, Transfer (via WalletControls).
'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet, EVM_NETWORKS, getEVMProvider, getEvmProviderFor, switchEvmNetwork, type EvmNetworkOption } from '@/lib/wallet';
import { showToast } from '@/lib/toast';

// Bloom Manager-style monochrome SVG icons per chain
function ChainIcon({ chainId, size = 18 }: { chainId: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', xmlns: 'http://www.w3.org/2000/svg', style: { flexShrink: 0 } };
  if (chainId === '0x1') return (
    <svg {...p}>
      <path d="M12.0059 1L5.25 12.2018L12.0059 16.1931L18.7617 12.2018L12.0059 1ZM12.0059 23L5.25 13.4824L12.0059 17.5L18.7617 13.4824L12.0059 23Z" />
    </svg>
  );
  if (chainId === '0x38') return (
    <svg {...p}>
      <path d="M6.16705 4.36681L12 1L17.833 4.36681L15.6885 5.61061L12 3.48758L8.31152 5.61061L6.16705 4.36681ZM17.833 8.61285L15.6885 7.36907L12 9.49209L8.31152 7.36907L6.16705 8.61285V11.1004L9.85553 13.2234V17.4695L12 18.7133L14.1445 17.4695V13.2234L17.833 11.1004V8.61285ZM17.833 15.3465V12.8589L15.6885 14.1026V16.5902L17.833 15.3465ZM19.3555 16.2257L15.667 18.3487V20.8363L21.5 17.4695V10.7358L19.3555 11.9797V16.2257ZM17.2111 6.48984L19.3555 7.73362V10.2212L21.5 8.97741V6.48984L19.3555 5.24605L17.2111 6.48984ZM9.85553 19.2494V21.737L12 22.9808L14.1445 21.737V19.2494L12 20.4932L9.85553 19.2494ZM6.16705 15.3465L8.31152 16.5902V14.1026L6.16705 12.8589V15.3465ZM9.85553 6.48984L12 7.73362L14.1445 6.48984L12 5.24605L9.85553 6.48984ZM4.64446 7.73362L6.78894 6.48984L4.64446 5.24605L2.5 6.48984V8.97741L4.64446 10.2212V7.73362ZM4.64446 11.9797L2.5 10.7358V17.4695L8.33294 20.8363V18.3487L4.64446 16.2257V11.9797Z" />
    </svg>
  );
  if (chainId === '0xa4b1') return (
    <svg {...p}>
      <path d="M11.088 4.924L5.637 19.162h2.895l1.104-3.042h4.728l1.104 3.042h2.895L12.912 4.924h-1.824zm.312 3.516l1.728 4.788H9.672l1.728-4.788z" />
    </svg>
  );
  if (chainId === 'solana') return (
    <svg {...p}>
      <path d="M21.897 17.1917L18.5954 20.7548C18.5236 20.8322 18.4367 20.894 18.3403 20.9361C18.2438 20.9783 18.1396 21.0001 18.0345 21H2.38329C2.30861 21 2.23555 20.978 2.17311 20.9368C2.11065 20.8956 2.06154 20.8369 2.03176 20.768C2.002 20.699 1.99289 20.6229 2.00555 20.5488C2.01822 20.4748 2.05211 20.4061 2.10305 20.3511L5.40715 16.788C5.47873 16.7108 5.56528 16.6492 5.66146 16.607C5.75766 16.5649 5.86143 16.543 5.96636 16.5428H21.6167C21.6914 16.5428 21.7644 16.5648 21.8269 16.606C21.8893 16.6472 21.9384 16.7059 21.9683 16.7748C21.998 16.8437 22.0071 16.9198 21.9945 16.9939C21.9817 17.068 21.9479 17.1368 21.897 17.1917ZM18.5954 10.0165C18.5236 9.93916 18.4367 9.87743 18.3403 9.83527C18.2438 9.7931 18.1396 9.77138 18.0345 9.77143H2.38329C2.30861 9.77143 2.23555 9.79339 2.17311 9.83458C2.11065 9.87581 2.06154 9.93446 2.03176 10.0034C2.002 10.0723 1.99289 10.1485 2.00555 10.2226C2.01822 10.2966 2.05211 10.3653 2.10305 10.4203L5.40715 13.9834C5.47873 14.0606 5.56528 14.1222 5.66146 14.1643C5.75766 14.2065 5.86143 14.2284 5.96636 14.2286H21.6167C21.6914 14.2286 21.7644 14.2066 21.8269 14.1654C21.8893 14.1242 21.9384 14.0655 21.9683 13.9966C21.998 13.9276 22.0071 13.8515 21.9945 13.7774C21.9817 13.7033 21.9479 13.6347 21.897 13.5797L18.5954 10.0165ZM2.38329 7.45714H18.0345C18.1396 7.45719 18.2438 7.43546 18.3403 7.39329C18.4367 7.3511 18.5236 7.2894 18.5954 7.21199L21.897 3.64885C21.9479 3.59391 21.9817 3.52519 21.9945 3.45113C22.0071 3.37706 21.998 3.30089 21.9683 3.23198C21.9384 3.16305 21.8893 3.10438 21.8269 3.06317C21.7644 3.02196 21.6914 3 21.6167 3H5.96636C5.86143 3.00018 5.75766 3.02203 5.66146 3.0642C5.56528 3.10636 5.47873 3.16795 5.40715 3.24514L2.10391 6.80829C2.05301 6.86317 2.01914 6.93183 2.00644 7.00579C1.99375 7.07978 2.00278 7.15588 2.03244 7.22478C2.06211 7.29367 2.11111 7.35234 2.17343 7.39361C2.23574 7.43489 2.30868 7.45696 2.38329 7.45714Z" />
    </svg>
  );
  return <svg {...p}><circle cx="12" cy="12" r="9" strokeWidth="2" fill="none" stroke="currentColor" /></svg>;
}

/**
 * The one network picker — same component everywhere a network needs to
 * be shown/picked (SiteNav's pages + the trade page's own header), so
 * switching behaves identically everywhere. The picker is always visible
 * (connected or not); picking a different network while connected asks the
 * wallet to switch chains, adding the chain first if the wallet doesn't
 * know it, and surfaces a specific error when the wallet can't (Phantom
 * has no BNB Chain or Arbitrum support, for one).
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

  async function pickNetwork(network: EvmNetworkOption) {
    setNetOpen(false);
    if (network.chainId === activeNetwork.chainId) return;
    // Solana isn't an EVM chain — there's no wallet_switchEthereumChain for it,
    // picking it just changes which address the nav shows.
    if (network.chainId === 'solana' || !evmAddress) {
      setActiveNetwork(network);
      return;
    }
    // Actually switch the wallet's chain. This used to call disconnect(),
    // which logged the user out for the crime of picking a network — while
    // switchEvmNetwork() sat right there, working, handling the add-chain
    // (4902) case and Phantom's chain gaps with a real error message.
    const provider = await getEvmProviderFor(evmAddress, network.chainId);
    if (!provider) return;
    const res = await switchEvmNetwork(provider, network);
    if (res.ok) setActiveNetwork(network);
    else showToast(res.reason ?? `Couldn't switch to ${network.name}`, 'err');
  }

  if (!mounted) return null;

  return (
    <>
      {netOpen && (
        <div
          className="fixed inset-0 z-[899]"
          style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.25)' }}
          onClick={() => setNetOpen(false)}
        />
      )}
      <div className="net-switch-wrap" ref={netRef}>
        <button className="net-switch-btn" onClick={() => setNetOpen(o => !o)} title={activeNetwork.name}>
          <ChainIcon chainId={activeNetwork.chainId} size={18} />
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {netOpen && (
          <div className="net-dropdown">
            {EVM_NETWORKS.map(n => (
              <button key={n.chainId} className="net-option" onClick={() => pickNetwork(n)} title={n.name} style={{ gap: '8px' }}>
                <ChainIcon chainId={n.chainId} size={16} />
                <span style={{ fontSize: '12px', color: '#c8d2d6', whiteSpace: 'nowrap' }}>{n.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
