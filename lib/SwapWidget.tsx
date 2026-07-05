'use client';

import { LiFiWidget, type WidgetConfig } from '@lifi/widget';
import { ChainType } from '@lifi/sdk';

// Arbitrum is the HL deposit chain — USDC on Arbitrum bridges into HL perps
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

export type SwapMode = 'deposit' | 'swap' | 'convert';

export interface SwapWidgetProps {
  mode?: SwapMode;
  toAddress?: string;
  fromToken?: string;
  fromAmount?: string;
}

export function SwapWidget({ mode = 'swap', toAddress, fromToken, fromAmount }: SwapWidgetProps) {
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
    feeConfig: { fee: 0.005 }, // 0.5% integrator cut — per build plan
    appearance: 'dark',
    theme: THEME,
    variant: 'wide',
    ...modeConfig,
  };

  // LiFiWidget (aliased from `App`) takes WidgetConfig fields as direct props,
  // not nested under a `config` key.
  return <LiFiWidget {...config} />;
}
