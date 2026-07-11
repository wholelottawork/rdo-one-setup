// 1inch Swap Proxy — keeps API key server-side
// Get a free key at: https://portal.1inch.dev
const BASE = 'https://api.1inch.dev/swap/v6.0';
const KEY  = process.env.ONEINCH_API_KEY;

function headers() {
  return {
    'Authorization': `Bearer ${KEY}`,
    'Accept': 'application/json',
  };
}

export default async function swapRoutes(fastify) {

  // GET /api/swap/quote?chainId=42161&src=0x...&dst=0x...&amount=1000000000000000000&from=0x...
  fastify.get('/quote', async (req, reply) => {
    if (!KEY) return reply.code(503).send({ error: 'ONEINCH_API_KEY not configured' });

    const { chainId = 42161, src, dst, amount, from } = req.query;
    if (!src || !dst || !amount) return reply.code(400).send({ error: 'src, dst, amount required' });

    const url = `${BASE}/${chainId}/quote?src=${src}&dst=${dst}&amount=${amount}${from ? '&from=' + from : ''}`;
    const cacheKey = `1inch:quote:${chainId}:${src}:${dst}:${amount}`;

    const cached = await fastify.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const res  = await fetch(url, { headers: headers() });
    const data = await res.json();

    fastify.redis.set(cacheKey, JSON.stringify(data), 'EX', 10).catch(() => {});
    return data;
  });

  // GET /api/swap/build?chainId=42161&src=0x...&dst=0x...&amount=X&from=0x...&slippage=1
  // Returns unsigned transaction data — never cached (time-sensitive)
  fastify.get('/build', async (req, reply) => {
    if (!KEY) return reply.code(503).send({ error: 'ONEINCH_API_KEY not configured' });

    const { chainId = 42161, src, dst, amount, from, slippage = 1 } = req.query;
    if (!src || !dst || !amount || !from) {
      return reply.code(400).send({ error: 'src, dst, amount, from required' });
    }

    const url = `${BASE}/${chainId}/swap?src=${src}&dst=${dst}&amount=${amount}&from=${from}&slippage=${slippage}&disableEstimate=true`;
    const res  = await fetch(url, { headers: headers() });
    const data = await res.json();

    if (data.error) return reply.code(400).send(data);

    return {
      toAmount: data.toAmount,
      tx: {
        to:       data.tx.to,
        data:     data.tx.data,
        value:    data.tx.value,
        gasPrice: data.tx.gasPrice,
        gas:      data.tx.gas,
      },
    };
  });

  // GET /api/swap/tokens?chainId=42161
  fastify.get('/tokens', async (req, reply) => {
    if (!KEY) return reply.code(503).send({ error: 'ONEINCH_API_KEY not configured' });

    const { chainId = 42161 } = req.query;
    const cacheKey = `1inch:tokens:${chainId}`;

    const cached = await fastify.redis.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached);

    const res  = await fetch(`${BASE}/${chainId}/tokens`, { headers: headers() });
    const data = await res.json();

    fastify.redis.set(cacheKey, JSON.stringify(data), 'EX', 3600).catch(() => {});
    return data;
  });
}
