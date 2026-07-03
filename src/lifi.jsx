import React from 'react';
import ReactDOM from 'react-dom/client';
import { LiFiWidget } from '@lifi/widget';

// Mode comes from ?mode=deposit|swap|convert in the URL
const params  = new URLSearchParams(location.search);
const mode    = params.get('mode') || 'swap';
// Optional: wallet address passed from parent page
const toAddr  = params.get('toAddress') || undefined;

// HyperEVM chain details (per build plan)
const HYPEREUM_CHAIN_ID = 998;
// USDC on HyperEVM — Hyperliquid's native USDC
const USDC_HYPEREVM = '0x6d3c5a55a8e09ef0e338e398fd0ac5e5fa5db445';

// RDO ONE HL theme
const THEME = {
  palette: {
    primary:    { main: '#50d2c1' },
    secondary:  { main: '#1fa67d' },
    background: { default: '#0f1a1e', paper: '#1b2429' },
    text:       { primary: '#ffffff', secondary: '#878c8f' },
    grey:       { 300: '#273035', 800: '#1b2429' },
  },
  shape: { borderRadius: 6, borderRadiusSecondary: 6 },
  typography: { fontFamily: '"Inter", system-ui, -apple-system, sans-serif' },
};

// Per-mode widget configuration
const CONFIGS = {
  deposit: {
    toChain:   HYPEREUM_CHAIN_ID,
    toToken:   USDC_HYPEREVM,
    toAddress: toAddr,
    fromChain: 'SOL',  // Solana — LI.FI uses chain key or id
    fromToken: 'SOL',
    hiddenUI:  ['toChain', 'toToken'],
    subvariant: 'split',
  },
  swap: {
    subvariant: 'default',
  },
  convert: {
    toToken:    'USDC',
    subvariant: 'split',
  },
};

const config = {
  integrator:  'rdo-one',
  fee:          0.005,   // 0.5% integrator cut — per build plan
  appearance:  'dark',
  theme:        THEME,
  variant:     'wide',
  ...(CONFIGS[mode] || CONFIGS.swap),
};

ReactDOM.createRoot(document.getElementById('root')).render(
  React.createElement(LiFiWidget, { config })
);
