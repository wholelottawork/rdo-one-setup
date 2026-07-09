const ARB_RPC = 'https://arb1.arbitrum.io/rpc';
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';

export interface ArbBalances {
  eth: number;
  usdc: number;
  ethPriceUsd: number;
}

async function rpcCall(method: string, params: unknown[], id: number): Promise<{ result?: string }> {
  const res = await fetch(ARB_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return res.json();
}

export async function loadArbitrumBalances(addr: string): Promise<ArbBalances> {
  const callData = '0x70a08231' + addr.replace('0x', '').padStart(64, '0');
  const [ethData, usdcData, priceJson] = await Promise.all([
    rpcCall('eth_getBalance', [addr, 'latest'], 1),
    rpcCall('eth_call', [{ to: USDC_ARB, data: callData }, 'latest'], 2),
    fetch('/api/coingecko/api/v3/simple/price?ids=ethereum&vs_currencies=usd').then(r => r.json()).catch(() => null),
  ]);

  const eth = parseInt(ethData.result || '0x0', 16) / 1e18;
  const usdc = parseInt(usdcData.result || '0x0', 16) / 1e6;
  const ethPriceUsd = priceJson?.ethereum?.usd ?? 0;
  return { eth, usdc, ethPriceUsd };
}
