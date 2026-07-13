import type { FastifyInstance } from 'fastify';
import { parseRSS, type ParsedArticle } from '../lib/rss-parser';
import { fetchText, fetchJSON } from '../lib/fetcher';
import { withCache } from '../lib/cache';

const R2J = 'https://api.rss2json.com/v1/api.json?rss_url=';

interface Source {
  id: string;
  name: string;
  url: string;
  type: 'direct' | 'r2j';
}

type NewsArticle = ParsedArticle & { source: string; sourceId: string };

const SOURCES: Source[] = [
  { id: 'ct',   name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss',                  type: 'direct' },
  { id: 'cd',   name: 'CoinDesk',      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', type: 'direct' },
  { id: 'dec',  name: 'Decrypt',       url: 'https://decrypt.co/feed',                         type: 'direct' },
  { id: 'bein', name: 'BeInCrypto',    url: 'https://beincrypto.com/feed/',                    type: 'direct' },
  { id: 'btci', name: 'Bitcoinist',    url: 'https://bitcoinist.com/feed/',                    type: 'direct' },
  { id: 'cs',   name: 'CryptoSlate',   url: 'https://cryptoslate.com/feed/',                   type: 'r2j' },
  { id: 'bwk',  name: 'Blockworks',    url: 'https://blockworks.co/feed',                      type: 'r2j' },
  { id: 'btcm', name: 'Bitcoin Mag',   url: 'https://bitcoinmagazine.com/feed',                type: 'direct' },
];

interface R2JItem {
  title?: string;
  link?: string;
  pubDate?: string;
  description?: string;
  thumbnail?: string;
  enclosure?: { link?: string };
  author?: string;
}

async function fetchSource(source: Source): Promise<NewsArticle[]> {
  try {
    if (source.type === 'direct') {
      const xml = await fetchText(source.url, { timeout: 7000 });
      return parseRSS(xml).map((a) => ({ ...a, source: source.name, sourceId: source.id }));
    }
    const json = await fetchJSON<{ items?: R2JItem[] }>(R2J + encodeURIComponent(source.url), { timeout: 9000 });
    if (!json?.items) return [];
    return json.items.map((item) => ({
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
    console.warn(`[news] ${source.name} failed: ${(err as Error).message}`);
    return [];
  }
}

function merge(arrays: NewsArticle[][]): NewsArticle[] {
  const seen = new Set<string>();
  const all: NewsArticle[]  = [];
  for (const arr of arrays) {
    for (const a of arr) {
      if (!a.link || seen.has(a.link)) continue;
      seen.add(a.link);
      all.push(a);
    }
  }
  return all.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());
}

export default async function newsRoutes(fastify: FastifyInstance) {
  // GET /api/news
  fastify.get('/', async () =>
    withCache(fastify.redis, 'news:all', 300, async () => {
      const results = await Promise.allSettled(SOURCES.map(fetchSource));
      const arrays  = results
        .filter((r): r is PromiseFulfilledResult<NewsArticle[]> => r.status === 'fulfilled')
        .map((r) => r.value);
      const failed  = SOURCES.filter((_, i) => results[i].status === 'rejected').map((s) => s.name);
      const articles = merge(arrays);

      return {
        articles,
        count:         articles.length,
        sources:       SOURCES.length,
        sourcesFailed: failed,
        updatedAt:     new Date().toISOString(),
      };
    }),
  );
}
