'use client';

import { useEffect, useRef, useState } from 'react';
import { useWallet } from '@/lib/wallet';

const shorten = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);

/**
 * The one wallet control — address chip that opens a dropdown with the
 * full(er) address + copy, and Disconnect. Matches Aster's own site
 * (reference: address row with copy icon, then Disconnect below) minus
 * the "View on explorer" row, which this app has no use for.
 *
 * `address` is whichever address the CALLER considers "the" one to show
 * (SiteNav passes whichever chain is active in its network switcher;
 * TradingTerminal — EVM only — always passes evmAddress) — this component
 * doesn't pick one itself, connect()/disconnect() always act on the whole
 * shared wallet session regardless.
 */
export function WalletDropdown({ address, connectLabel, triggerClassName = 'nav-wallet-btn' }: { address: string | null; connectLabel?: string; triggerClassName?: string }) {
  const { isConnecting, checked, connect, disconnect } = useWallet();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    function onOutsideClick(e: MouseEvent) {
      if (open && ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('click', onOutsideClick);
    return () => document.removeEventListener('click', onOutsideClick);
  }, [open]);

  const connected = !!address;

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address).catch(() => { /* silent */ });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="nav-wallet-wrap" ref={ref}>
      <button
        className={`${triggerClassName}${mounted && connected ? ' connected' : ''}`}
        onClick={() => (connected ? setOpen(o => !o) : connect())}
        disabled={!checked || isConnecting}
      >
        {!checked ? '…' : isConnecting ? 'Connecting…' : mounted && connected && address ? shorten(address) : (connectLabel ?? 'Connect')}
      </button>
      {open && connected && address && (
        <div className="wallet-dd-panel">
          <div className="wallet-dd-addr-row">
            <span>{shorten(address)}</span>
            <button className="wallet-dd-copy" onClick={copyAddress} title="Copy address" aria-label="Copy address">
              {copied
                ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" /></svg>}
            </button>
          </div>
          <div className="wallet-dd-divider" />
          <button className="wallet-dd-disconnect" onClick={() => { disconnect(); setOpen(false); }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18.36 6.64a9 9 0 11-12.73 0M12 2v10" /></svg>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
