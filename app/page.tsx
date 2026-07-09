'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useWallet, getEVMProvider } from '@/lib/wallet';
import { useToast } from '@/lib/toast';
import { useHLSocket, useHLBookStream, type Trade } from '@/lib/hl-socket';
import { useHLCandles } from '@/lib/hl-hooks';
import {
  useAsterCandles, useAsterBook, useAsterTradeStream, useAsterUserStream,
} from '@/lib/aster-hooks';
import { openPosition, closePosition, cancelOrder, getL2Book, type OrderBook } from '@/lib/hyperliquid';
import { asterPlaceOrder, asterClosePosition, asterCancelOrder } from '@/lib/aster';
import { type TradeMode } from '@/lib/markets';
import { useShell } from '@/app/_components/ShellContext';
import { ChartColumn } from '@/app/_components/ChartColumn';
import { TradesColumn } from '@/app/_components/TradesColumn';
import { TradePanel } from '@/app/_components/TradePanel';
import { DepositModal } from '@/app/_components/DepositModal';

export default function TerminalPage() {
  return (
    <Suspense fallback={null}>
      <TerminalPageInner />
    </Suspense>
  );
}

function TerminalPageInner() {
  const params = useSearchParams();
  const shell = useShell();

  // Sync URL params to shell state on mount
  useEffect(() => {
    const mode = params.get('mode') === 'aster' ? 'aster' : 'hl';
    const market = params.get('sym')?.toUpperCase() || 'BTC';
    const network = params.get('net') === 'testnet' ? 'testnet' : 'mainnet';
    shell.setMode(mode as TradeMode);
    shell.setMarket(market);
    shell.setNetwork(network);
  }, []); // run once on mount

  return <Terminal />;
}

function Terminal() {
  const shell = useShell();

  // Trade-specific state
  const [intervalMinutes, setIntervalMinutes] = useState(1);
  const [isBuy, setIsBuy] = useState(true);
  const [size, setSize] = useState('');
  const [leverage, setLeverage] = useState(20);
  const [depositOpen, setDepositOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [hlBook, setHlBook] = useState<OrderBook>({ asks: [], bids: [] });

  const { address, connect } = useWallet();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const { subscribeTrades } = useHLSocket();

  // Use shell values for shared state
  const { mode, market, network, isAster, livePrices, livePrice, balance, positions } = shell;

  // Fetch candles, book, trades (trade-specific data)
  const { data: hlCandles } = useHLCandles(market, intervalMinutes, network);
  const { data: asterCandles } = useAsterCandles(market, intervalMinutes);
  const { data: asterBook } = useAsterBook(market, isAster);

  const candles = isAster ? asterCandles : hlCandles;

  // HL order book: seed with REST snapshot, then stream
  useEffect(() => {
    if (isAster) return;
    let stale = false;
    getL2Book(market, network).then(book => { if (!stale) setHlBook(book); });
    return () => { stale = true; };
  }, [market, isAster, network]);
  const onHLBook = useCallback((book: OrderBook) => setHlBook(book), []);
  useHLBookStream(isAster ? '' : market, onHLBook, network);
  const book = isAster ? (asterBook ?? { asks: [], bids: [] }) : hlBook;

  // Trades feed
  useEffect(() => setTrades([]), [market, mode]);
  const onTrade = useCallback((trade: Trade) => setTrades(prev => [trade, ...prev].slice(0, 80)), []);
  useEffect(() => {
    if (isAster) return;
    return subscribeTrades(market, onTrade);
  }, [isAster, market, onTrade, subscribeTrades]);

  // Aster live trades stream
  const { trades: asterTrades } = useAsterTradeStream(market, isAster);

  // Aster user stream for live account updates
  const asterOnUpdate = useCallback(() => {
    if (!address) return;
    queryClient.invalidateQueries({ queryKey: ['aster', 'balance', address] });
    queryClient.invalidateQueries({ queryKey: ['aster', 'positions', address] });
    queryClient.invalidateQueries({ queryKey: ['aster', 'openOrders', address] });
  }, [address, queryClient]);
  useAsterUserStream(isAster ? address : null, asterOnUpdate);

  const currentPosition = positions.find(p => p.symbol === market);
  const totalUnrealizedPnl = positions.reduce((s, p) => s + p.pnl, 0);

  async function submitTrade() {
    if (!address) {
      await connect();
      return;
    }

    const sizeNum = parseFloat(size);
    if (!sizeNum || sizeNum <= 0) { flashError('Enter a size'); return; }

    setSubmitting(true);
    try {
      if (isAster) {
        const px = livePrice ?? 0;
        if (!px) { flashError('Cannot fetch price'); setSubmitting(false); return; }
        const coinSize = sizeNum;
        const result = await asterPlaceOrder({
          symbol: market,
          size: coinSize,
          price: 0,
          isLong: isBuy,
          isMarket: true,
          userAddress: address,
        });
        if (result.status === 'ok') {
          showToast(`${isBuy ? 'Long' : 'Short'} ${market} opened`, 'ok');
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['aster', 'positions', address] });
            queryClient.invalidateQueries({ queryKey: ['aster', 'balance', address] });
          }, 2000);
        } else {
          flashError(result.response ?? 'Order failed');
        }
      } else {
        const provider = getEVMProvider();
        if (!provider) { flashError('No wallet found'); setSubmitting(false); return; }
        const { ethers } = await import('ethers');
        const signer = await new ethers.BrowserProvider(provider as never).getSigner();
        const px = livePrice ?? 0;
        const result = await openPosition({ symbol: market, sizeDollars: sizeNum * px, leverage, isLong: isBuy, signer, network });
        if (result.status === 'ok') {
          showToast(`${isBuy ? 'Long' : 'Short'} ${market} opened`, 'ok');
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ['hl', 'positions', address, network] }), 2000);
        } else {
          flashError(result.response ?? 'Order failed');
        }
      }
    } catch (e) {
      flashError(e instanceof Error ? e.message : 'Transaction failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleClosePosition(index: number) {
    if (!address) return;
    const p = positions[index];
    if (!p) return;

    try {
      if (isAster) {
        const result = await asterClosePosition({
          symbol: p.symbol,
          size: p.size,
          isLong: p.isLong,
          userAddress: address,
        });
        if (result.status === 'ok') {
          showToast('Position closed', 'ok');
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['aster', 'positions', address] });
            queryClient.invalidateQueries({ queryKey: ['aster', 'balance', address] });
          }, 2000);
        } else {
          showToast(result.response ?? 'Close failed', 'err');
        }
      } else {
        const provider = getEVMProvider();
        if (!provider) return;
        const { ethers } = await import('ethers');
        const signer = await new ethers.BrowserProvider(provider as never).getSigner();
        const result = await closePosition({ symbol: p.symbol, size: p.size, isLong: p.isLong, signer, network });
        if (result.status === 'ok') {
          showToast('Position closed', 'ok');
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ['hl', 'positions', address, network] }), 2000);
        } else {
          showToast(result.response ?? 'Close failed', 'err');
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Close failed', 'err');
    }
  }

  async function handleCancelOrder(oid: number, symbol: string) {
    if (!address) return;

    try {
      if (isAster) {
        const result = await asterCancelOrder({ oid, symbol, userAddress: address });
        if (result.status === 'ok') {
          showToast('Order cancelled', 'ok');
          queryClient.invalidateQueries({ queryKey: ['aster', 'openOrders', address] });
        } else {
          showToast(result.response ?? 'Cancel failed', 'err');
        }
      } else {
        const provider = getEVMProvider();
        if (!provider) return;
        const { ethers } = await import('ethers');
        const signer = await new ethers.BrowserProvider(provider as never).getSigner();
        const result = await cancelOrder({ oid, symbol, signer, network });
        if (result.status === 'ok') {
          showToast('Order cancelled', 'ok');
          queryClient.invalidateQueries({ queryKey: ['hl', 'openOrders', address, network] });
        } else {
          showToast(result.response ?? 'Cancel failed', 'err');
        }
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Cancel failed', 'err');
    }
  }

  function flashError(msg: string) {
    setSubmitError(msg);
    setTimeout(() => setSubmitError(null), 5000);
  }

  return (
    <div className="trade-content-grid">
      <ChartColumn
        mode={mode}
        market={market}
        intervalMinutes={intervalMinutes}
        candles={candles}
        livePrice={livePrice}
        onIntervalChange={setIntervalMinutes}
      />
      <TradesColumn mode={mode} market={market} trades={trades} asterTrades={asterTrades} />
      <TradePanel
        mode={mode}
        market={market}
        isBuy={isBuy}
        size={size}
        leverage={leverage}
        livePrice={livePrice}
        balance={balance}
        currentPositionSize={currentPosition ? currentPosition.size : null}
        totalUnrealizedPnl={totalUnrealizedPnl}
        submitting={submitting}
        error={submitError}
        book={book}
        onSideChange={setIsBuy}
        onSizeChange={setSize}
        onLeverageChange={setLeverage}
        onSubmit={submitTrade}
      />
      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </div>
  );
}
