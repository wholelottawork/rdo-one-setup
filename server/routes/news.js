import { parseRSS } from '../lib/rss-parser.js';
import { fetchText, fetchJSON } from '../lib/fetcher.js';

const R2J = 'https://api.rss2json.com/v1/api.json?rss_url=';

const SOURCES = [
  { id: 'ct',   name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss',                  type: 'direct' },
  { id: 'cd',   name: 'CoinDesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', type: 'direct' },
  { id: 'dec',  name: 'Decrypt',       url: 'https://decrypt.co/feed',                         type: 'direct' },
  { id: 'bein', name: 'BeInCrypto',    url: 'https://beincrypto.com/feed/',                    type: 'direct' },
  { id: 'btci', name: 'Bitcoinist',    url: 'https://bitcoinist.com/feed/',                    type: 'direct' },
  { id: 'cs',   name: 'CryptoSlate',   url: 'https://cryptoslate.com/feed/',                   type: 'r2j' },
  { id: 'bwk',  name: 'Blockworks',    url: 'https://blockworks.co/feed',                      type: 'r2j' },
  { id: 'btcm', name: 'Bitcoin Mag',   url: 'https://bitcoinmagazine.com/.rss/full/',           type: 'r2j' },
];

async function fetchSource(source) {
  try {
    if (source.type === 'direct') {
      const xml = await fetchText(source.url, { timeout: 7000 });
      return parseRSS(xml).map(a => ({ ...a, source: source.name, sourceId: source.id }));
    }
    const json = await fetchJSON(R2J + encodeURIComponent(source.url), { timeout: 9000 });
    if (!json?.items) return [];
    return json.items.map(item => ({
      title:    item.title || '',
      link:     item.link || '',
      pubDate:  item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      desc:     (item.description || '').replace(/<[^>]+>/g, '').slice(0, 220),
      image:    item.thumbnail || item.enclosure?.link || null,
      author:   item.author || '',
      source:   source.name,
      sourceId: source.id,
    }));
  } catch (err) {
    console.warn(`[news] ${source.name} failed: ${err.message}`);
    return [];
  }
}

function merge(arrays) {
  const seen = new Set();
  const all  = [];
  for (const arr of arrays) {
    for (const a of arr) {
      if (!a.link || seen.has(a.link)) continue;
      seen.add(a.link);
      all.push(a);
    }
  }
  return all.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

export default async function newsRoutes(fastify) {

  // GET /api/news
  fastify.get('/', async () => {
    const KEY = 'news:all';
    const TTL = 300;

    const cached = await fastify.redis.get(KEY).catch(() => null);
    if (cached) return JSON.parse(cached);

    const results = await Promise.allSettled(SOURCES.map(fetchSource));
    const arrays  = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed  = SOURCES.filter((_, i) => results[i].status === 'rejected').map(s => s.name);
    const articles = merge(arrays);

    const response = {
      articles,
      count:         articles.length,
      sources:       SOURCES.length,
      sourcesFailed: failed,
      updatedAt:     new Date().toISOString(),
    };

    fastify.redis.set(KEY, JSON.stringify(response), 'EX', TTL).catch(() => {});
    return response;
  });
}
