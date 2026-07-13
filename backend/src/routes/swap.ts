import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config';
import { withCache } from '../lib/cache';

// 1inch Swap Proxy — keeps API key server-side
// Get a free key at: https://portal.1inch.dev
const BASE = 'https://api.1inch.dev/swap/v6.0';
const KEY = config.oneInchApiKey;

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${KEY}`,
    Accept: 'application/json',
  };
}

interface SwapQuery {
  chainId?: string;
  src?: string;
  dst?: string;
  amount?: string;
  from?: string;
  slippage?: string;
}

interface OneInchSwapResponse {
  error?: unknown;
  toAmount?: string;
  tx?: { to: string; data: string; value: string; gasPrice: string; gas: string };
}

export default async function swapRoutes(fastify: FastifyInstance) {
  // GET /api/swap/quote?chainId=42161&src=0x...&dst=0x...&amount=1000000000000000000&from=0x...
  fastify.get('/quote', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!KEY) return reply.code(503).send({ error: 'ONEINCH_API_KEY not configured' });

    const { chainId = 42161, src, dst, amount, from } = req.query as SwapQuery;
    if (!src || !dst || !amount) return reply.code(400).send({ error: 'src, dst, amount required' });

    const url = `${BASE}/${chainId}/quote?src=${src}&dst=${dst}&amount=${amount}${from ? '&from=' + from : ''}`;
    const cacheKey = `1inch:quote:${chainId}:${src}:${dst}:${amount}`;

    return withCache(fastify.redis, cacheKey, 10, async () => {
      const res = await fetch(url, { headers: headers() });
      return res.json();
    });
  });

  // GET /api/swap/build?chainId=42161&src=0x...&dst=0x...&amount=X&from=0x...&slippage=1
  // Returns unsigned transaction data — never cached (time-sensitive)
  fastify.get('/build', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!KEY) return reply.code(503).send({ error: 'ONEINCH_API_KEY not configured' });

    const { chainId = 42161, src, dst, amount, from, slippage = 1 } = req.query as SwapQuery;
    if (!src || !dst || !amount || !from) {
      return reply.code(400).send({ error: 'src, dst, amount, from required' });
    }

    const url = `${BASE}/${chainId}/swap?src=${src}&dst=${dst}&amount=${amount}&from=${from}&slippage=${slippage}&disableEstimate=true`;
    const res = await fetch(url, { headers: headers() });
    const data = (await res.json()) as OneInchSwapResponse;

    if (data.error) return reply.code(400).send(data);

    return {
      toAmount: data.toAmount,
      tx: {
        to:       data.tx!.to,
        data:     data.tx!.data,
        value:    data.tx!.value,
        gasPrice: data.tx!.gasPrice,
        gas:      data.tx!.gas,
      },
    };
  });

  // GET /api/swap/tokens?chainId=42161
  fastify.get('/tokens', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!KEY) return reply.code(503).send({ error: 'ONEINCH_API_KEY not configured' });

    const { chainId = 42161 } = req.query as SwapQuery;
    const cacheKey = `1inch:tokens:${chainId}`;

    return withCache(fastify.redis, cacheKey, 3600, async () => {
      const res = await fetch(`${BASE}/${chainId}/tokens`, { headers: headers() });
      return res.json();
    });
  });
}
