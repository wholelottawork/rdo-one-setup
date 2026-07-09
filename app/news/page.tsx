'use client';

import './news.css';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/lib/i18n';
import { useNews, timeAgo, SOURCE_META, CATEGORIES, type Article } from '@/lib/news';

const PAGE_SIZE = 18;

// upgradeImageUrl() — verbatim from public/news.html
function upgradeImageUrl(url: string): string {
  if (!url) return url;
  if (url.includes('images.cointelegraph.com'))
    url = url.replace(/\/images\/\d+_/, '/images/1200_');
  if (url.includes('cloudinary.com')) {
    url = url.replace(/\/w_\d+,h_\d+/, '/w_1200,h_675');
    url = url.replace(/\/w_\d+(?=,|\/|$)/, '/w_1200');
  }
  url = url.replace(/(-\d{2,4}x\d{2,4})(\.[a-zA-Z0-9]{2,5})(\?|$)/, '$2$3');
  url = url.replace(/([?&]w=)\d+/, (_m, p) => p + '1200');
  url = url.replace(/([?&]width=)\d+/, (_m, p) => p + '1200');
  url = url.replace(/([?&]resize=)\d+,\d+/, (_m, p) => p + '1200,675');
  return url;
}

function ArticleCard({ a }: { a: Article }) {
  const [imgFailed, setImgFailed] = useState(false);
  const color = SOURCE_META[a.sourceId]?.color;
  const img = a.image ? upgradeImageUrl(a.image) : '';

  return (
    <div className="article" onClick={() => window.open(a.link, '_blank', 'noopener')}>
      <div className="art-img-wrap">
        {img && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="art-img" src={img} alt="" loading="lazy" onError={() => setImgFailed(true)} />
        ) : (
          <div className="art-img-ph">📰</div>
        )}
      </div>
      <div className="art-body">
        <div className="art-meta">
          <span className="art-src" style={{ color }}>{a.source}</span>
          <span className="art-time">{a.pubDate ? timeAgo(a.pubDate) : ''}</span>
        </div>
        <div className="art-title">{a.title}</div>
        {a.desc ? <div className="art-excerpt">{a.desc.slice(0, 200)}</div> : null}
      </div>
    </div>
  );
}

function Skeletons({ n }: { n: number }) {
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <div className="sk-card" key={i}>
          <div className="sk-img"></div>
          <div className="sk-body">
            <div className="sk-line" style={{ width: '50%', height: 8 }}></div>
            <div className="sk-line" style={{ width: '100%', height: 11, marginTop: 2 }}></div>
            <div className="sk-line" style={{ width: '85%', height: 11 }}></div>
            <div className="sk-line" style={{ width: '60%', height: 11 }}></div>
            <div className="sk-line" style={{ width: '40%', height: 8, marginTop: 4 }}></div>
          </div>
        </div>
      ))}
    </>
  );
}

export default function NewsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, error } = useNews();

  const [activeCat, setActiveCat] = useState(CATEGORIES[0]);
  const [activeSrcIds, setActiveSrcIds] = useState<Set<string>>(() => new Set(Object.keys(SOURCE_META)));
  const [shown, setShown] = useState(PAGE_SIZE);

  const allArticles = useMemo(() => data?.articles ?? [], [data]);

  // applyFilters() — category keywords + source toggles
  const visibleArticles = useMemo(() => {
    let result = allArticles;
    if (activeCat.kw.length) {
      const kw = activeCat.kw;
      result = result.filter(a => {
        const text = (a.title + ' ' + a.desc).toLowerCase();
        return kw.some(k => text.includes(k));
      });
    }
    if (activeSrcIds.size < Object.keys(SOURCE_META).length) {
      result = result.filter(a => activeSrcIds.has(a.sourceId));
    }
    return result;
  }, [allArticles, activeCat, activeSrcIds]);

  function selectCat(id: string) {
    const cat = CATEGORIES.find(c => c.id === id);
    if (!cat || cat.id === activeCat.id || isLoading) return;
    setActiveCat(cat);
    setShown(PAGE_SIZE);
  }

  function toggleSrc(sid: string) {
    setActiveSrcIds(prev => {
      const next = new Set(prev);
      if (next.has(sid)) {
        if (next.size === 1) return prev;
        next.delete(sid);
      } else {
        next.add(sid);
      }
      return next;
    });
    setShown(PAGE_SIZE);
  }

  function refresh() {
    queryClient.invalidateQueries({ queryKey: ['news'] });
  }

  const sourcesTotal = Object.keys(SOURCE_META).length;
  const failed = data?.sourcesFailed ?? [];
  const ok = sourcesTotal - failed.length;

  return (
    <>
      <div className="page-hdr">
          <div className="hdr-right">
            <span id="update-ts">{data ? 'Updated ' + new Date(data.updatedAt).toLocaleTimeString() : ''}</span>
            <button className="refresh-btn" id="refresh-btn" disabled={isFetching} onClick={refresh}>{t('refresh')}</button>
          </div>
        </div>

        <div className="filter-row" id="cat-filters">
          {CATEGORIES.map(c => (
            <button key={c.id} className={`filter-btn${c.id === activeCat.id ? ' active' : ''}`} onClick={() => selectCat(c.id)}>{c.label}</button>
          ))}
        </div>

        <div className="source-row" id="src-filters">
          {Object.entries(SOURCE_META).map(([sid, meta]) => (
            <button key={sid} className={`src-btn${activeSrcIds.has(sid) ? ' active' : ''}`} onClick={() => toggleSrc(sid)}>{meta.name}</button>
          ))}
        </div>

        <div className="feed-status" id="feed-status">
          {data ? (
            <><span>{ok}</span>/{sourcesTotal} sources loaded · {allArticles.length} articles{failed.length ? ` · failed: ${failed.join(', ')}` : ''}</>
          ) : null}
        </div>

        <div className="news-grid" id="news-grid">
          {isLoading ? (
            <Skeletons n={9} />
          ) : error ? (
            <div className="state-box"><div className="state-icon">⚠️</div><div>Failed to load: {error.message}</div></div>
          ) : visibleArticles.length === 0 ? (
            <div className="state-box"><div className="state-icon">📭</div><div>No articles found.</div></div>
          ) : (
            visibleArticles.slice(0, shown).map(a => <ArticleCard key={a.link} a={a} />)
          )}
        </div>

        <div id="load-more-wrap" style={{ display: !isLoading && shown < visibleArticles.length ? 'block' : 'none' }}>
          <button className="load-more-btn" onClick={() => setShown(s => Math.min(s + PAGE_SIZE, visibleArticles.length))}>{t('loadMore')}</button>
        </div>
    </>
  );
}
