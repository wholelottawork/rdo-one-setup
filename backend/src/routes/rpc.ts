import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { fetchJSON } from '../lib/fetcher';
import { RPC_URLS } from '../lib/evm-chains';
import { config } from '../config';

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
const READ_METHODS = new Set([
  'eth_call',
  'eth_getBalance',
  'eth_blockNumber',
  'eth_getTransactionReceipt',
]);

/**
 * Solana rides the same allowlist machinery under the pseudo-chain "solana".
 *
 * It is here rather than called straight from the browser because the endpoint
 * everyone reaches for, api.mainnet-beta.solana.com, now answers 403 "Access
 * forbidden" to anything that is not a Solana Labs internal caller — from a
 * browser AND from a server. That 403 is what left the Portfolio page with no
 * SPL balances at all. Public nodes that do answer (the default below) are
 * rate limited per IP, so they get the same cache-and-share treatment as the
 * EVM side.
 *
 * SOLANA_RPC exists so this can be pointed at a Helius/Alchemy/Triton URL —
 * that URL usually embeds an API key, which is exactly why it must live in the
 * server env and be reached through here, never inlined into the bundle.
 */
const SOLANA_READ_METHODS = new Set([
  'getBalance',
  'getTokenAccountsByOwner',
  'getTokenAccountBalance',
  'getAccountInfo',
  'getMultipleAccounts',
  'getParsedTokenAccountsByOwner',
  'getSignaturesForAddress',
  'getHealth',
]);

interface RpcCall {
  method?: string;
  params?: unknown[];
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  // `data` carries a reverting contract's own error selector and arguments.
  // Nodes are inconsistent about whether they also spell it into `message`, so
  // it is forwarded as its own field rather than left to chance — a caller that
  // wants to tell one revert reason from another has nothing else to go on.
  error?: { message?: string; data?: unknown };
}

/** A JSON-RPC error, flattened for the wire. `revertData` is the raw `0x…`
 *  of a custom error where the node supplied one; absent otherwise. */
function rpcError(error: { message?: string; data?: unknown } | undefined) {
  const data = error?.data;
  return {
    error: error?.message ?? 'RPC error',
    ...(typeof data === 'string' && data.startsWith('0x') ? { revertData: data } : {}),
  };
}

export default async function rpcRoutes(fastify: FastifyInstance) {
  // POST /api/rpc/42161  { method: 'eth_call', params: [...] }
  // POST /api/rpc/solana { method: 'getBalance', params: [...] }
  //
  // A body of `{ calls: [{method, params}, ...] }` is answered as
  // `{ results: [...] }` in the same order. Batching matters for the portfolio
  // sweep: reading a native balance plus N token balances on seven chains is
  // ~40 round trips one at a time, and public nodes rate limit on request
  // count. Every call in a batch is allowlisted individually, so a batch can
  // never smuggle in a method a single call could not make.
  fastify.post('/:chainId', async (req: FastifyRequest, reply: FastifyReply) => {
    const { chainId } = req.params as { chainId: string };
    const isSolana = chainId === 'solana';
    const url = isSolana ? config.solanaRpc : RPC_URLS[chainId];
    if (!url) return reply.code(400).send({ error: `Unsupported chainId ${chainId}` });
    const allowed = isSolana ? SOLANA_READ_METHODS : READ_METHODS;

    const body = (req.body ?? {}) as RpcCall & { calls?: RpcCall[] };
    const batch = Array.isArray(body.calls);
    const calls: RpcCall[] = batch ? body.calls! : [body];

    if (!calls.length) return reply.code(400).send({ error: 'No calls supplied' });
    // Bounded so one request cannot turn the backend into an amplifier: a
    // single POST here becomes one upstream POST, but its cost upstream scales
    // with this length.
    if (calls.length > 50) return reply.code(400).send({ error: 'Too many calls (max 50)' });

    for (const call of calls) {
      if (!call?.method || !allowed.has(call.method)) {
        return reply.code(400).send({ error: `Method not allowed: ${call?.method ?? '(none)'}` });
      }
    }

    const payload = calls.map((call, i) => ({
      jsonrpc: '2.0',
      id: i + 1,
      method: call.method,
      params: call.params ?? [],
    }));

    const res = await fetchJSON<JsonRpcResponse | JsonRpcResponse[]>(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(batch ? payload : payload[0]),
      // Above fetchJSON's 8s default: getTokenAccountsByOwner returns a fully
      // parsed account per token and is genuinely slow on a wallet with many
      // of them — at 8s it aborted, and the page rendered that as an error on
      // a wallet whose only sin was holding a lot of tokens.
      timeout: 20_000,
    });

    if (!batch) {
      const single = res as JsonRpcResponse;
      if (single.error) return reply.code(502).send(rpcError(single.error));
      return { result: single.result };
    }

    // A batch response may come back in any order, and a node that rejects the
    // whole batch answers with a bare object instead of an array — normalize
    // both into one result slot per call so the caller can index by position.
    const list = Array.isArray(res) ? res : [];
    if (!list.length) {
      const err = (res as JsonRpcResponse)?.error?.message ?? 'RPC batch failed';
      return reply.code(502).send({ error: err });
    }
    const byId = new Map(list.map((r) => [r.id, r]));
    return {
      results: calls.map((_, i) => {
        const entry = byId.get(i + 1);
        return entry?.error
          ? rpcError(entry.error)
          : { result: entry?.result ?? null };
      }),
    };
  });
}
