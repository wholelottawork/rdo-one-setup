'use client';

import { useQuery } from '@tanstack/react-query';

// Shape returned by the Fastify backend's GET /api/news (server/routes/news.js)
export interface Article {
  title: string;
  link: string;
  pubDate: string;
  desc: string;
  image: string | null;
  author: string;
  source: string;
  sourceId: string;
}

// Source ids/names match server/routes/news.js SOURCES; colors match the
// original public/news.html SOURCES table.
export const SOURCE_META: Record<string, { name: string; color: string }> = {
  ct: { name: 'CoinTelegraph', color: '#50d2c1' },
  cd: { name: 'CoinDesk', color: '#f7931a' },
  dec: { name: 'Decrypt', color: '#7b68ee' },
  cs: { name: 'CryptoSlate', color: '#3498db' },
  bwk: { name: 'Blockworks', color: '#e74c3c' },
  btcm: { name: 'Bitcoin Mag', color: '#f39c12' },
  bein: { name: 'BeInCrypto', color: '#27ae60' },
  btci: { name: 'Bitcoinist', color: '#9b59b6' },
};

// Categories — verbatim from public/news.html CATS
export const CATEGORIES = [
  { id: 'all', label: 'All', kw: [] as string[] },
  { id: 'bitcoin', label: 'Bitcoin', kw: ['bitcoin', 'btc'] },
  { id: 'ethereum', label: 'Ethereum', kw: ['ethereum', 'eth'] },
  { id: 'solana', label: 'Solana', kw: ['solana', 'sol'] },
  { id: 'defi', label: 'DeFi', kw: ['defi', 'decentralized finance', 'yield', 'amm'] },
  { id: 'altcoins', label: 'Altcoins', kw: ['altcoin', 'altcoins', 'xrp', 'cardano', 'polygon', 'avalanche'] },
  { id: 'nft', label: 'NFT', kw: ['nft', 'non-fungible'] },
  { id: 'regulation', label: 'Regulation', kw: ['regulation', 'sec', 'cftc', 'legal', 'compliance', 'congress', 'ban'] },
];

export function timeAgo(dateStr: string): string {
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (d < 60) return d + 's ago';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
}

interface NewsResponse {
  articles: Article[];
  count: number;
  sources: number;
  sourcesFailed: string[];
  updatedAt: string;
}

export function useNews() {
  return useQuery<NewsResponse>({
    queryKey: ['news'],
    queryFn: async () => {
      const res = await fetch('/api/news');
      return res.json();
    },
    refetchInterval: 300_000,
  });
}
