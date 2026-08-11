import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withCache } from '../lib/cache';
import { fetchJSON } from '../lib/fetcher';
import { RPC_URLS } from '../lib/evm-chains';
import { config } from '../config';

/**
 * "What does this address hold, across every EVM chain we support?" — one call.
 *
 * This lives on the backend rather than in the Portfolio page because the
 * answer takes a fan-out the browser should not be doing: a native-balance
 * read plus a token sweep on each of seven chains, then one price lookup for
 * everything found. Done client-side that is dozens of requests from the
 * user's IP to public nodes that rate limit per IP, and the failures land
 * as a half-drawn portfolio with no explanation.
 *
 * Two ways to find tokens, picked by whether an Alchemy key is configured:
 *
 *   - With ALCHEMY_API_KEY: alchemy_getTokenBalances reports every ERC-20 the
 *     address actually holds. This is real discovery — it finds tokens nobody
 *     put on a list.
 *   - Without it (the default, and free): probe a curated list of majors and
 *     stables per chain via balanceOf. It cannot find an arbitrary token, but
 *     it needs no key, no signup, and covers what most portfolios are made of.
 *
 * Prices come from DeFiLlama, which is keyless and takes `chain:address` keys,
 * so a token found by either path can be priced without a per-token coin id.
 */

/** chainId → the DeFiLlama chain slug and a human label. */
const CHAINS: Record<string, { slug: string; name: string; nativeSymbol: string; nativeCoin: string }> = {
  '1':     { slug: 'ethereum',  name: 'Ethereum',  nativeSymbol: 'ETH',   nativeCoin: 'coingecko:ethereum' },
  '10':    { slug: 'optimism',  name: 'Optimism',  nativeSymbol: 'ETH',   nativeCoin: 'coingecko:ethereum' },
  '56':    { slug: 'bsc',       name: 'BNB Chain', nativeSymbol: 'BNB',   nativeCoin: 'coingecko:binancecoin' },
  '137':   { slug: 'polygon',   name: 'Polygon',   nativeSymbol: 'POL',   nativeCoin: 'coingecko:matic-network' },
  '8453':  { slug: 'base',      name: 'Base',      nativeSymbol: 'ETH',   nativeCoin: 'coingecko:ethereum' },
  '42161': { slug: 'arbitrum',  name: 'Arbitrum',  nativeSymbol: 'ETH',   nativeCoin: 'coingecko:ethereum' },
  '43114': { slug: 'avax',      name: 'Avalanche', nativeSymbol: 'AVAX',  nativeCoin: 'coingecko:avalanche-2' },
};

/** Alchemy network slugs, for the chains Alchemy serves. */
const ALCHEMY_NETWORKS: Record<string, string> = {
  '1': 'eth-mainnet',
  '10': 'opt-mainnet',
  '137': 'polygon-mainnet',
  '8453': 'base-mainnet',
  '42161': 'arb-mainnet',
  '43114': 'avax-mainnet',
};

interface TokenDef {
  address: string;
  symbol: string;
  decimals: number;
}

/**
 * The keyless fallback's search space. Deliberately short: every entry is one
 * more balanceOf in the batch, and a list long enough to be "complete" would
 * be slower than it is useful. Majors and stables only — anything exotic is
 * what the Alchemy path is for.
 */
const CURATED: Record<string, TokenDef[]> = {
  '1': [
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI',  decimals: 18 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
    { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', decimals: 18 },
  ],
  '10': [
    { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6 },
    { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', decimals: 6 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
    { address: '0x4200000000000000000000000000000000000042', symbol: 'OP',   decimals: 18 },
  ],
  '56': [
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 },
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 },
    { address: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', symbol: 'WBNB', decimals: 18 },
  ],
  '137': [
    { address: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', symbol: 'USDC', decimals: 6 },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', decimals: 6 },
    { address: '0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619', symbol: 'WETH', decimals: 18 },
  ],
  '8453': [
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
    { address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', decimals: 18 },
    { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI',  decimals: 18 },
  ],
  '42161': [
    { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', symbol: 'USDC', decimals: 6 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
    { address: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', symbol: 'WETH', decimals: 18 },
    { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', decimals: 8 },
    { address: '0x912CE59144191C1204E64559FE8253a0e49E6548', symbol: 'ARB',  decimals: 18 },
  ],
  '43114': [
    { address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', symbol: 'USDC', decimals: 6 },
    { address: '0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7', symbol: 'USDT', decimals: 6 },
    { address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', symbol: 'WAVAX', decimals: 18 },
  ],
};

const BALANCE_OF = '0x70a08231';

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: string };
}

/** hex quantity → number scaled by `decimals`. Empty/0x/reverted reads are 0. */
function fromHex(hex: unknown, decimals: number): number {
  if (typeof hex !== 'string' || hex.length < 3) return 0;
  let raw: bigint;
  try {
    raw = BigInt(hex);
  } catch {
    return 0;
  }
  if (raw === 0n) return 0;
  // Via string rather than Number(raw)/10**d: a whale balance overflows the
  // safe-integer range before the division ever happens.
  const s = raw.toString().padStart(decimals + 1, '0');
  return parseFloat(`${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)}`);
}

/** One batched JSON-RPC POST. Returns results positionally; failures are null. */
async function rpcBatch(url: string, calls: { method: string; params: unknown[] }[]) {
  if (!calls.length) return [];
  const payload = calls.map((c, i) => ({ jsonrpc: '2.0', id: i + 1, ...c }));
  const res = await fetchJSON<JsonRpcResponse[]>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    timeout: 10_000,
  });
  const byId = new Map((Array.isArray(res) ? res : []).map((r) => [r.id, r]));
  return calls.map((_, i) => byId.get(i + 1)?.result ?? null);
}

interface AlchemyTokenBalances {
  result?: { tokenBalances?: { contractAddress: string; tokenBalance: string | null }[] };
}
interface AlchemyMetadata {
  result?: { symbol?: string | null; decimals?: number | null; name?: string | null; logo?: string | null };
}

/**
 * Alchemy path: ask which tokens the address holds, then fetch metadata for
 * the non-zero ones. Capped at 25 tokens per chain — the metadata calls are
 * one request each, and a dust-covered address can report hundreds of
 * balances that are worth nothing.
 */
async function discoverViaAlchemy(chainId: string, address: string): Promise<HeldToken[]> {
  const network = ALCHEMY_NETWORKS[chainId];
  if (!network) return [];
  const url = `https://${network}.g.alchemy.com/v2/${config.alchemyApiKey}`;

  const balances = await fetchJSON<AlchemyTokenBalances>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getTokenBalances', params: [address, 'erc20'] }),
    timeout: 12_000,
  });

  const held = (balances.result?.tokenBalances ?? [])
    .filter((t) => t.tokenBalance && /[1-9a-f]/i.test(t.tokenBalance.slice(2)))
    .slice(0, 25);
  if (!held.length) return [];

  const metas = await Promise.all(
    held.map((t) =>
      fetchJSON<AlchemyMetadata>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'alchemy_getTokenMetadata', params: [t.contractAddress] }),
        timeout: 10_000,
      }).catch(() => ({}) as AlchemyMetadata),
    ),
  );

  return held.map((t, i) => {
    const meta = metas[i].result ?? {};
    const decimals = typeof meta.decimals === 'number' ? meta.decimals : 18;
    return {
      token: { address: t.contractAddress, symbol: meta.symbol || '???', decimals },
      balance: fromHex(t.tokenBalance, decimals),
      ...(meta.logo ? { logo: meta.logo } : {}),
    };
  });
}

/** A held token, however it was discovered. `logo` only comes from Alchemy. */
interface HeldToken {
  token: TokenDef;
  balance: number;
  logo?: string;
}

/** Keyless path: balanceOf every curated token for this chain, in one batch. */
async function discoverViaCuratedList(chainId: string, address: string): Promise<HeldToken[]> {
  const list = CURATED[chainId] ?? [];
  if (!list.length) return [];
  const data = BALANCE_OF + address.replace(/^0x/, '').toLowerCase().padStart(64, '0');
  const results = await rpcBatch(
    RPC_URLS[chainId],
    list.map((t) => ({ method: 'eth_call', params: [{ to: t.address, data }, 'latest'] })),
  );
  return list
    .map((token, i) => ({ token, balance: fromHex(results[i], token.decimals) }))
    .filter((r) => r.balance > 0);
}

interface LlamaPrices {
  coins?: Record<string, { price?: number; symbol?: string }>;
}

async function priceAll(keys: string[]): Promise<Record<string, number>> {
  if (!keys.length) return {};
  const out: Record<string, number> = {};
  // Chunked: the key list goes in the URL path, and a wallet spread over seven
  // chains can otherwise build a URL long enough to be rejected outright.
  for (let i = 0; i < keys.length; i += 40) {
    const chunk = keys.slice(i, i + 40);
    const body = await fetchJSON<LlamaPrices>(
      `https://coins.llama.fi/prices/current/${chunk.join(',')}`,
      { timeout: 10_000 },
    ).catch(() => ({}) as LlamaPrices);
    for (const [k, v] of Object.entries(body.coins ?? {})) {
      if (typeof v.price === 'number') out[k.toLowerCase()] = v.price;
    }
  }
  return out;
}

export default async function evmBalancesRoutes(fastify: FastifyInstance) {
  // GET /api/evm-balances?address=0x…&chains=1,42161,8453
  fastify.get('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const { address, chains } = req.query as { address?: string; chains?: string };
    if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return reply.code(400).send({ error: 'A valid `address` is required' });
    }

    const requested = (chains ?? Object.keys(CHAINS).join(','))
      .split(',')
      .map((c) => c.trim())
      .filter((c) => CHAINS[c]);
    if (!requested.length) return reply.code(400).send({ error: 'No supported chains requested' });

    const useAlchemy = !!config.alchemyApiKey;
    const key = `evmbal:${useAlchemy ? 'a' : 'c'}:${address.toLowerCase()}:${requested.join(',')}`;

    // 30s: long enough that a re-render or a second tab is free, short enough
    // that a user who just received funds and hits Refresh sees them.
    return withCache(fastify.redis, key, 30, async () => {
      const perChain = await Promise.all(
        requested.map(async (chainId) => {
          const meta = CHAINS[chainId];
          // A single chain failing must not empty the whole portfolio — the
          // other six answers are still worth showing. But a failure must not
          // be reported as an empty wallet either: both halves are settled
          // separately and any rejection is recorded, because a chain that
          // errors and a chain where you genuinely hold nothing look
          // identical downstream otherwise. That is exactly how the two dead
          // public RPCs (see lib/evm-chains.ts) hid for as long as they did.
          const [nativeRes, tokensRes] = await Promise.allSettled([
            rpcBatch(RPC_URLS[chainId], [{ method: 'eth_getBalance', params: [address, 'latest'] }])
              .then((r) => r[0]),
            useAlchemy ? discoverViaAlchemy(chainId, address) : discoverViaCuratedList(chainId, address),
          ]);

          const errors = [nativeRes, tokensRes]
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map((r) => (r.reason as Error)?.message ?? 'request failed');

          return {
            chainId,
            name: meta.name,
            slug: meta.slug,
            nativeSymbol: meta.nativeSymbol,
            nativeBalance: nativeRes.status === 'fulfilled' ? fromHex(nativeRes.value, 18) : 0,
            tokens: tokensRes.status === 'fulfilled' ? tokensRes.value : ([] as HeldToken[]),
            error: errors.length ? errors.join('; ') : null,
          };
        }),
      );

      const priceKeys = new Set<string>();
      for (const c of perChain) {
        if (c.nativeBalance > 0) priceKeys.add(CHAINS[c.chainId].nativeCoin);
        for (const t of c.tokens) priceKeys.add(`${c.slug}:${t.token.address.toLowerCase()}`);
      }
      const prices = await priceAll([...priceKeys]);
      const priceOf = (k: string) => prices[k.toLowerCase()] ?? 0;

      let total = 0;
      const result = perChain.map((c) => {
        const nativePrice = priceOf(CHAINS[c.chainId].nativeCoin);
        const assets = [] as {
          symbol: string; address: string | null; balance: number; price: number; value: number; logo?: string;
        }[];

        if (c.nativeBalance > 0) {
          assets.push({
            symbol: c.nativeSymbol,
            address: null,
            balance: c.nativeBalance,
            price: nativePrice,
            value: c.nativeBalance * nativePrice,
          });
        }
        for (const t of c.tokens) {
          const price = priceOf(`${c.slug}:${t.token.address}`);
          assets.push({
            symbol: t.token.symbol,
            address: t.token.address,
            balance: t.balance,
            price,
            value: t.balance * price,
            ...(t.logo ? { logo: t.logo } : {}),
          });
        }
        assets.sort((a, b) => b.value - a.value);
        const chainTotal = assets.reduce((s, a) => s + a.value, 0);
        total += chainTotal;
        return { chainId: c.chainId, name: c.name, total: chainTotal, assets, error: c.error };
      });

      return {
        address,
        // Surfaced so the page can say "curated list" rather than implying it
        // searched every token in existence and found nothing.
        discovery: useAlchemy ? 'alchemy' : 'curated',
        total,
        chains: result.filter((c) => c.assets.length > 0 || c.error),
      };
    });
  });
}
