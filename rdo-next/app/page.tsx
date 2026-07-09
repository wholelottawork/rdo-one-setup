'use client';

import dynamic from 'next/dynamic';

const TradingTerminal = dynamic(() => import('@/components/TradingTerminal'), { ssr: false });

export default function TradePage() {
  return <TradingTerminal />;
}
