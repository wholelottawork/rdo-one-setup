export interface PhantomSolanaProvider {
  isPhantom?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect: () => Promise<void>;
  on: (event: string, cb: () => void) => void;
}

export function getPhantomSolana(): PhantomSolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { phantom?: { solana?: PhantomSolanaProvider }; solana?: PhantomSolanaProvider };
  return w.phantom?.solana ?? w.solana ?? null;
}

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const TOKEN_PROG = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SOL_RPC = 'https://api.mainnet-beta.solana.com';

async function rpc<T>(method: string, params: unknown[]): Promise<{ result: T }> {
  const res = await fetch(SOL_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}

interface TokenAccount {
  mint: string;
  balance: number;
}

async function getSolBalance(pubkey: string): Promise<number> {
  const { result } = await rpc<{ value: number }>('getBalance', [pubkey, { commitment: 'confirmed' }]);
  return (result?.value ?? 0) / 1e9;
}

async function getTokenAccounts(pubkey: string): Promise<TokenAccount[]> {
  const { result } = await rpc<{ value: Array<{ account: { data: { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } } } }> }>(
    'getTokenAccountsByOwner',
    [pubkey, { programId: TOKEN_PROG }, { encoding: 'jsonParsed', commitment: 'confirmed' }],
  );
  return (result?.value ?? [])
    .map(a => ({ mint: a.account.data.parsed.info.mint, balance: a.account.data.parsed.info.tokenAmount.uiAmount ?? 0 }))
    .filter(t => t.balance > 0);
}

async function getJupPrices(mints: string[]): Promise<Record<string, { price: string }>> {
  if (!mints.length) return {};
  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${mints.join(',')}`);
    const json = await res.json();
    return json?.data ?? {};
  } catch {
    return {};
  }
}

export interface TokenMeta {
  name: string;
  symbol: string;
  logo: string;
}

let tokenMetaCache: Record<string, TokenMeta> | null = null;

async function loadTokenMeta(): Promise<Record<string, TokenMeta>> {
  if (tokenMetaCache) return tokenMetaCache;
  const meta: Record<string, TokenMeta> = {};
  try {
    const list = (await (await fetch('https://tokens.jup.ag/tokens?tags=strict')).json()) as Array<{
      address: string; name: string; symbol: string; logoURI: string;
    }>;
    list.forEach(t => { meta[t.address] = { name: t.name, symbol: t.symbol, logo: t.logoURI }; });
  } catch {
    // fall through with whatever we have (just SOL below)
  }
  meta[SOL_MINT] = {
    name: 'Solana', symbol: 'SOL',
    logo: 'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/So11111111111111111111111111111111111111112/logo.png',
  };
  tokenMetaCache = meta;
  return meta;
}

export interface SolAsset {
  mint: string;
  balance: number;
  price: number;
  value: number;
  name: string;
  symbol: string;
  logo: string;
}

export async function loadSolanaPortfolio(pubkey: string): Promise<SolAsset[]> {
  const meta = await loadTokenMeta();
  const [solBal, tokenAccs] = await Promise.all([getSolBalance(pubkey), getTokenAccounts(pubkey)]);
  const mints = [SOL_MINT, ...tokenAccs.map(t => t.mint)];
  const prices = await getJupPrices(mints);

  const assets: SolAsset[] = [];
  const solPx = parseFloat(prices[SOL_MINT]?.price ?? '0');
  const solMeta = meta[SOL_MINT] ?? { name: 'Solana', symbol: 'SOL', logo: '' };
  assets.push({ mint: SOL_MINT, balance: solBal, price: solPx, value: solBal * solPx, ...solMeta });

  tokenAccs.forEach(t => {
    const px = parseFloat(prices[t.mint]?.price ?? '0');
    const m = meta[t.mint] ?? { name: t.mint.slice(0, 8) + '…', symbol: '???', logo: '' };
    assets.push({ mint: t.mint, balance: t.balance, price: px, value: t.balance * px, ...m });
  });

  assets.sort((a, b) => b.value - a.value);
  return assets;
}
