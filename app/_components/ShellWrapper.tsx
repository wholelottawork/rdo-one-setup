'use client';

import { usePathname } from 'next/navigation';
import { useShell } from './ShellContext';
import { Header } from './Header';
import { XTracker } from './XTracker';
import { StatusBar } from './StatusBar';
import { BottomPanel } from './BottomPanel';
import { BottomPanelShell } from './BottomPanelShell';

/** Persistent shell wrapper that lives in the root layout.
 *  It mounts once and persists across all client-side navigations.
 *  All state (mode, market, network, stats, bottom panel data) comes from
 *  ShellContext so it's preserved when switching pages. */
export function ShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const activePage = pathname === '/' ? 'trade'
    : pathname?.startsWith('/markets') ? 'markets'
    : pathname?.startsWith('/news') ? 'news'
    : pathname?.startsWith('/portfolio') ? 'portfolio'
    : pathname?.startsWith('/transfer') ? 'transfer'
    : pathname?.startsWith('/swap') ? 'swap'
    : 'trade';

  const {
    mode, setMode, market, setMarket, network, setNetwork,
    headerStats, dropdownRows, balance, positions, fills,
    openOrders, funding, livePrices, address, status,
    handleClosePosition, handleCancelOrder,
  } = useShell();

  return (
    <>
      <div id="app">
        <Header
          mode={mode}
          market={market}
          stats={headerStats}
          balance={0}
          dropdownRows={dropdownRows}
          onModeChange={setMode}
          onSelectMarket={setMarket}
          onOpenDeposit={() => {}}
          network={network}
          onNetworkChange={setNetwork}
          activePage={activePage}
        />

        <div className="workspace">
          <XTracker market={market} />
          <div className="page-content-area">
            {children}
          </div>
        </div>

        <BottomPanelShell>
          <BottomPanel
            mode={mode}
            address={address}
            positions={positions}
            fills={fills}
            openOrders={openOrders}
            funding={funding}
            livePrices={livePrices}
            onClosePosition={handleClosePosition}
            onCancelOrder={handleCancelOrder}
            onTabData={() => {}}
          />
        </BottomPanelShell>

        <StatusBar status={status} />
      </div>
    </>
  );
}
