export const HL_MARKETS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'LINK', 'DOT',
  'UNI', 'ATOM', 'LTC', 'PEPE', 'WIF', 'BONK', 'JUP', 'ARB', 'OP', 'SUI',
  'APT', 'INJ', 'SEI', 'TIA', 'GMX', 'PENDLE', 'BLUR', 'SHIB', 'FLOKI',
  'NEAR', 'FTM', 'MATIC', 'SAND', 'MANA', 'AXS', 'ENJ', 'CHZ', 'RUNE',
  'LDO', 'CRV', 'AAVE', 'MKR', 'SNX', 'COMP', '1INCH', 'IMX', 'FIL', 'AR',
];

export const ASTER_MARKETS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'AVAX', 'ADA', 'LINK', 'DOT',
  'SUI', 'APT', 'INJ', 'ARB', 'OP', 'PEPE', 'WIF', 'NEAR', 'ATOM', 'UNI',
];

export type TradeMode = 'hl' | 'aster';

export function fmtPrice(p: number | null | undefined, sym?: string): string {
  if (!p || isNaN(p)) return '—';
  const a = Math.abs(p);
  if (a >= 10000) return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (a >= 100) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 1) return p.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  return p.toLocaleString('en-US', { minimumFractionDigits: 5, maximumFractionDigits: 6 });
}

export function fmtSize(n: number | null | undefined): string {
  if (!n) return '0';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

export function fmtLarge(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

export function ivLabel(iv: number): string {
  if (iv < 60) return iv + 'm';
  if (iv < 1440) return iv / 60 + 'h';
  return '1D';
}

// Aster price formatting — ported from main.js fmtAster()
export function fmtAster(n: number | null | undefined): string {
  if (n == null || isNaN(n) || n === 0) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (n >= 1) return n.toFixed(2);
  return n.toPrecision(4);
}
