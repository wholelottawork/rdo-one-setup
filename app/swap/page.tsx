'use client';

import './swap.css';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { LiFiWidget, type WidgetConfig } from '@lifi/widget';
import { ChainType } from '@lifi/sdk';

const ARBITRUM_CHAIN_ID = 42161;
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

const THEME = {
  colorSchemes: {
    dark: {
      palette: {
        primary: { main: '#50d2c1' },
        secondary: { main: '#1fa67d' },
        background: { default: '#0f1a1e', paper: '#1b2429' },
        text: { primary: '#ffffff', secondary: '#878c8f' },
        grey: { 300: '#273035', 800: '#1b2429' },
      },
    },
  },
  shape: { borderRadius: 6 },
  typography: { fontFamily: '"Inter", system-ui, -apple-system, sans-serif' },
};

function SwapPageInner() {
  const searchParams = useSearchParams();
  const mode = (searchParams.get('mode') as 'deposit' | 'swap' | 'convert') || 'swap';
  const toAddress = searchParams.get('toAddress') || undefined;
  const fromToken = searchParams.get('fromToken') || undefined;
  const fromAmount = searchParams.get('fromAmount') || undefined;

  const modeConfig: Partial<WidgetConfig> =
    mode === 'deposit'
      ? {
          toChain: ARBITRUM_CHAIN_ID,
          toToken: USDC_ARBITRUM,
          toAddress: toAddress ? { address: toAddress, chainType: ChainType.EVM } : undefined,
          fromToken: fromToken || 'SOL',
          ...(fromAmount ? { fromAmount } : {}),
          hiddenUI: { toToken: true, chainSelect: true },
          disabledUI: { toToken: true },
        }
      : mode === 'convert'
        ? { toToken: 'USDC' }
        : {};

  const config: WidgetConfig = {
    integrator: 'rdo-one',
    feeConfig: { fee: 0.005 },
    appearance: 'dark',
    theme: THEME,
    variant: 'wide',
    ...modeConfig,
  };

  return (
    <div className="swap-root">
      <LiFiWidget {...config} />
    </div>
  );
}

export default function SwapPage() {
  return (
    <Suspense fallback={<div className="swap-fallback">Loading…</div>}>
      <SwapPageInner />
    </Suspense>
  );
}
