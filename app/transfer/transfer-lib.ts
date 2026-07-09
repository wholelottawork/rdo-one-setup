// On-chain / protocol helpers ported verbatim from public/transfer.html.
// All backend calls go through the Fastify proxy (/api/*).

export interface EIP1193 { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; isPhantom?: boolean }

export const USDC_ARB = '0xaf88d065e77c8cc2239327c5edb3a432268e5831';
export const USDT_ARB = '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9';
const HL = '/api/hl';
const ASTER = '/api/aster-fapi';
const LIFI = '/api/lifi-api';

export const fmt = (n: number, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface ChainDef { id: string; name: string; tokens: Array<{ sym: string; addr: string; dec: number }> }

export const CHAINS: ChainDef[] = [
  { id: '42161', name: 'Arbitrum', tokens: [
    { sym: 'ETH', addr: '0x0000000000000000000000000000000000000000', dec: 18 },
    { sym: 'USDC', addr: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', dec: 6 },
    { sym: 'USDT', addr: '0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9', dec: 6 },
    { sym: 'ARB', addr: '0x912ce59144191c1204e64559fe8253a0e49e6548', dec: 18 },
    { sym: 'WBTC', addr: '0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f', dec: 8 },
  ]},
  { id: '1', name: 'Ethereum', tokens: [
    { sym: 'ETH', addr: '0x0000000000000000000000000000000000000000', dec: 18 },
    { sym: 'USDC', addr: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', dec: 6 },
    { sym: 'USDT', addr: '0xdac17f958d2ee523a2206206994597c13d831ec7', dec: 6 },
    { sym: 'WBTC', addr: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', dec: 8 },
  ]},
  { id: '8453', name: 'Base', tokens: [
    { sym: 'ETH', addr: '0x0000000000000000000000000000000000000000', dec: 18 },
    { sym: 'USDC', addr: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', dec: 6 },
    { sym: 'cbBTC', addr: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', dec: 8 },
  ]},
  { id: '10', name: 'Optimism', tokens: [
    { sym: 'ETH', addr: '0x0000000000000000000000000000000000000000', dec: 18 },
    { sym: 'USDC', addr: '0x0b2c639c533813f4aa9d7837caf62653d097ff85', dec: 6 },
    { sym: 'USDT', addr: '0x94b008aa00579c1307b0ef2c499ad98a8ce58e58', dec: 6 },
    { sym: 'OP', addr: '0x4200000000000000000000000000000000000042', dec: 18 },
  ]},
  { id: '137', name: 'Polygon', tokens: [
    { sym: 'POL', addr: '0x0000000000000000000000000000000000000000', dec: 18 },
    { sym: 'USDC', addr: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', dec: 6 },
    { sym: 'USDT', addr: '0xc2132d05d31c914a87c6611c10748aeb04b58e8f', dec: 6 },
    { sym: 'WBTC', addr: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', dec: 8 },
  ]},
  { id: '56', name: 'BNB Chain', tokens: [
    { sym: 'BNB', addr: '0x0000000000000000000000000000000000000000', dec: 18 },
    { sym: 'USDT', addr: '0x55d398326f99059ff775485246999027b3197955', dec: 18 },
    { sym: 'USDC', addr: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d', dec: 18 },
    { sym: 'ETH', addr: '0x2170ed0880ac9a755fd29b2688956bd959f933f8', dec: 18 },
  ]},
  { id: '43114', name: 'Avalanche', tokens: [
    { sym: 'AVAX', addr: '0x0000000000000000000000000000000000000000', dec: 18 },
    { sym: 'USDC', addr: '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e', dec: 6 },
    { sym: 'USDT', addr: '0x9702230a8ea53601f5cd2dc00fdbc13d4df4a8c7', dec: 6 },
  ]},
];

export function getProv(): EIP1193 | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { phantom?: { ethereum?: EIP1193 }; ethereum?: EIP1193 };
  return w.phantom?.ethereum ?? w.ethereum ?? null;
}

export async function loadHLEquity(addr: string): Promise<number> {
  try {
    const r = await fetch(HL + '/info', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'clearinghouseState', user: addr }) });
    const d = await r.json();
    const ms = d.crossMarginSummary || d.marginSummary || {};
    return parseFloat(ms.accountValue ?? 0);
  } catch {
    return 0;
  }
}

// ── On-chain helpers ──────────────────────────────────────────────────────────
export async function getERC20Bal(prov: EIP1193, token: string, owner: string): Promise<bigint> {
  const data = '0x70a08231' + owner.slice(2).padStart(64, '0');
  const hex = (await prov.request({ method: 'eth_call', params: [{ to: token, data }, 'latest'] })) as string;
  return BigInt(hex || '0x0');
}

export async function ensureApproval(prov: EIP1193, token: string, owner: string, spender: string, amount: string) {
  const ZERO = '0x0000000000000000000000000000000000000000';
  if (!token || token === ZERO) return;
  const pad = (v: string) => v.replace(/^0x/, '').padStart(64, '0');
  const allHex = (await prov.request({ method: 'eth_call', params: [{ to: token, data: '0xdd62ed3e' + pad(owner) + pad(spender) }, 'latest'] })) as string;
  if (BigInt(allHex || '0x0') >= BigInt(amount)) return;
  const appHash = (await prov.request({ method: 'eth_sendTransaction', params: [{ from: owner, to: token, data: '0x095ea7b3' + pad(spender) + BigInt(amount).toString(16).padStart(64, '0') }] })) as string;
  await pollReceipt(prov, appHash, 120000);
}

export async function erc20Send(prov: EIP1193, token: string, from: string, to: string, amount: string): Promise<string> {
  const pad = (v: string) => v.replace(/^0x/, '').padStart(64, '0');
  return (await prov.request({ method: 'eth_sendTransaction', params: [{ from, to: token, data: '0xa9059cbb' + pad(to) + BigInt(amount).toString(16).padStart(64, '0') }] })) as string;
}

export async function pollReceipt(prov: EIP1193, hash: string, ms = 120000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = (await prov.request({ method: 'eth_getTransactionReceipt', params: [hash] })) as { status?: string } | null;
    if (r) { if (r.status === '0x0') throw new Error('Transaction reverted'); return r; }
    await sleep(2500);
  }
  throw new Error('Confirmation timeout');
}

export async function pollBal(prov: EIP1193, token: string, owner: string, needed: bigint, baseline: bigint, timeoutMs: number): Promise<bigint> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const bal = await getERC20Bal(prov, token, owner);
    if (bal >= baseline + needed) return bal;
    await sleep(12000);
  }
  throw new Error('Timeout — funds did not arrive. Check your account and retry.');
}

// ── LI.FI helpers ─────────────────────────────────────────────────────────────
export interface LifiQuote {
  transactionRequest: { to: string; data: string; value?: string; gasLimit?: string };
  action?: { fromToken?: { address?: string }; fromAmount?: string; toToken?: { decimals?: number; symbol?: string } };
  estimate?: {
    toAmount?: string;
    approvalAddress?: string;
    executionDuration?: number;
    feeCosts?: Array<{ amountUSD?: string }>;
    gasCosts?: Array<{ amountUSD?: string }>;
  };
  includedSteps?: Array<{ tool?: string; type?: string; toolDetails?: { name?: string } }>;
}

export async function lifiQuote(fromChain: string, toChain: string, fromToken: string, toToken: string, fromAmount: string, fromAddr: string, toAddr?: string): Promise<LifiQuote> {
  const p = new URLSearchParams({ fromChain, toChain, fromToken, toToken, fromAmount, fromAddress: fromAddr, toAddress: toAddr || fromAddr, slippage: '0.005' });
  const r = await fetch(`${LIFI}/v1/quote?` + p);
  if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { message?: string })?.message || 'LI.FI: no route found'); }
  return r.json();
}

export async function lifiExec(prov: EIP1193, quote: LifiQuote, user: string): Promise<string> {
  const tx = quote.transactionRequest;
  await ensureApproval(prov, quote.action?.fromToken?.address ?? '', user, quote.estimate?.approvalAddress || tx.to, quote.action?.fromAmount ?? '0');
  return (await prov.request({
    method: 'eth_sendTransaction', params: [{
      from: user, to: tx.to, data: tx.data,
      value: tx.value ? '0x' + BigInt(tx.value).toString(16) : '0x0',
      ...(tx.gasLimit ? { gas: '0x' + BigInt(tx.gasLimit).toString(16) } : {}),
    }],
  })) as string;
}

// ── Raw protocol helpers ──────────────────────────────────────────────────────
export async function hlWithdrawRaw(prov: EIP1193, user: string, amt: number, dest: string) {
  const ts = Date.now();
  const td = {
    types: {
      EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'version', type: 'string' }, { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' }],
      'HyperliquidTransaction:Withdraw': [{ name: 'hyperliquidChain', type: 'string' }, { name: 'destination', type: 'string' }, { name: 'amount', type: 'string' }, { name: 'time', type: 'uint64' }],
    },
    primaryType: 'HyperliquidTransaction:Withdraw',
    domain: { name: 'HyperliquidSignTransaction', version: '1', chainId: 42161, verifyingContract: '0x0000000000000000000000000000000000000000' },
    message: { hyperliquidChain: 'Mainnet', destination: dest, amount: String(amt), time: ts },
  };
  const sig = (await prov.request({ method: 'eth_signTypedData_v4', params: [user, JSON.stringify(td)] })) as string;
  const res = await fetch(HL + '/exchange', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      action: { type: 'withdraw3', hyperliquidChain: 'Mainnet', signatureChainId: '0xa4b1', amount: String(amt), time: ts, destination: dest },
      nonce: ts,
      signature: { r: sig.slice(0, 66), s: '0x' + sig.slice(66, 130), v: parseInt(sig.slice(130, 132), 16) },
    }),
  });
  const d = await res.json();
  if (d?.status !== 'ok' && d?.response?.type !== 'default')
    throw new Error(d?.response?.data?.message || d?.error || JSON.stringify(d).slice(0, 100));
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sb = await crypto.subtle.sign('HMAC', k, enc.encode(payload));
  return Array.from(new Uint8Array(sb)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function asterWithdrawRaw(key: string, secret: string, amt: number, dest: string) {
  const ts = Date.now(), qs = `asset=USDT&amount=${amt}&address=${encodeURIComponent(dest)}&timestamp=${ts}`;
  const sig = await hmacHex(secret, qs);
  const res = await fetch(`${ASTER}/v1/withdraw?${qs}&signature=${sig}`, { method: 'POST', headers: { 'X-MBX-APIKEY': key } });
  const d = await res.json();
  if (!res.ok || d.code) throw new Error(d?.msg || d?.message || JSON.stringify(d).slice(0, 100));
}

export async function asterDepositAddr(key: string, secret: string): Promise<string | null> {
  try {
    const ts = Date.now(), qs = `coin=USDT&network=ARBITRUM&timestamp=${ts}`;
    const sig = await hmacHex(secret, qs);
    const r = await fetch(`${ASTER}/v1/capital/deposit/address?${qs}&signature=${sig}`, { headers: { 'X-MBX-APIKEY': key } });
    if (!r.ok) return null;
    const d = await r.json();
    return d?.address || d?.data?.address || null;
  } catch {
    return null;
  }
}
