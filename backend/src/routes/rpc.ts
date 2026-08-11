import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fetchJSON } from '../lib/fetcher';

/**
 * Read-only JSON-RPC proxy, one chain per path segment.
 *
 * Exists because a wallet can only answer for the chain it is currently
 * pointed at: eth_call goes wherever the user's wallet is, so a flow that
 * moves funds BETWEEN chains cannot read the destination chain's balance
 * through the wallet at all. The deposit flow hit this — converting BNB-chain
 * USDC to Arbitrum USDT has to watch an Arbitrum balance while the wallet sits
 * on BNB, and the node answered `0x` for a contract that does not exist there.
 *
 * Deliberately NOT a general RPC relay:
 *   - chains are an allowlist, so this cannot be pointed at arbitrary hosts;
 *   - methods are an allowlist of READS. Without it this endpoint would happily
 *     forward eth_sendRawTransaction and become an open, unattributable
 *     broadcast relay for anyone who finds it.
 * Uncached: these are balance reads whose whole purpose is to observe a change,
 * and a cache would report the pre-arrival balance for its whole TTL.
 */
const RPC_URLS: Record<string, string> = {
  '1': 'https://eth.llamarpc.com',
  '10': 'https://mainnet.optimism.io',
  '56': 'https://bsc-dataseed.binance.org',
  '137': 'https://polygon-rpc.com',
  '8453': 'https://mainnet.base.org',
  '42161': 'https://arb1.arbitrum.io/rpc',
  '43114': 'https://api.avax.network/ext/bc/C/rpc',
};

const READ_METHODS = new Set([
  'eth_call',
  'eth_getBalance',
  'eth_blockNumber',
  'eth_getTransactionReceipt',
]);

interface RpcBody {
  method?: string;
  params?: unknown[];
}

export default async function rpcRoutes(fastify: FastifyInstance) {
  // POST /api/rpc/42161  { method: 'eth_call', params: [...] }
  fastify.post('/:chainId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { chainId } = req.params as { chainId: string };
    const url = RPC_URLS[chainId];
    if (!url) return reply.code(400).send({ error: `Unsupported chainId ${chainId}` });

    const { method, params } = (req.body ?? {}) as RpcBody;
    if (!method || !READ_METHODS.has(method)) {
      return reply.code(400).send({ error: `Method not allowed: ${method ?? '(none)'}` });
    }

    const body = await fetchJSON<{ result?: unknown; error?: { message?: string } }>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params ?? [] }),
    });

    if (body.error) return reply.code(502).send({ error: body.error.message ?? 'RPC error' });
    return { result: body.result };
  });
}
