export function parseRSS(xml) {
  const articles = [];

  // RSS 2.0
  const itemRx = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRx.exec(xml)) !== null) {
    const b = m[1];
    const title   = extractTag(b, 'title');
    const link    = extractTag(b, 'link') || extractAttr(b, 'link', 'href');
    const pubDate = extractTag(b, 'pubDate') || extractTag(b, 'published');
    const desc    = extractTag(b, 'description') || extractTag(b, 'summary');
    const image   = extractImage(b);
    const author  = extractTag(b, 'author') || extractTag(b, 'dc:creator');
    if (title && link) {
      articles.push({
        title:   cleanHTML(title),
        link:    link.trim(),
        pubDate: pubDate ? new Date(pubDate.trim()).toISOString() : new Date().toISOString(),
        desc:    cleanHTML(desc || '').slice(0, 220),
        image,
        author: cleanHTML(author || ''),
      });
    }
  }

  // Atom fallback
  if (articles.length === 0) {
    const entryRx = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
    while ((m = entryRx.exec(xml)) !== null) {
      const b = m[1];
      const title   = extractTag(b, 'title');
      const link    = extractAttr(b, 'link', 'href');
      const pubDate = extractTag(b, 'published') || extractTag(b, 'updated');
      const desc    = extractTag(b, 'summary') || extractTag(b, 'content');
      if (title && link) {
        articles.push({
          title:   cleanHTML(title),
          link:    link.trim(),
          pubDate: pubDate ? new Date(pubDate.trim()).toISOString() : new Date().toISOString(),
          desc:    cleanHTML(desc || '').slice(0, 220),
          image:   extractImage(b),
          author:  '',
        });
      }
    }
  }

  return articles;
}

function extractTag(xml, tag) {
  const rx = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`, 'i');
  const m = xml.match(rx);
  if (!m) return null;
  return (m[1] || m[2] || '').trim();
}

function extractAttr(xml, tag, attr) {
  const rx = new RegExp(`<${tag}[^>]+${attr}=["']([^"']+)["']`, 'i');
  const m = xml.match(rx);
  return m ? m[1].trim() : null;
}

function extractImage(block) {
  const patterns = [
    /<media:content[^>]+url=["']([^"']+)["']/i,
    /<media:thumbnail[^>]+url=["']([^"']+)["']/i,
    /<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i,
  ];
  for (const rx of patterns) {
    const m = block.match(rx);
    if (m) return m[1];
  }
  return null;
}

function cleanHTML(str) {
  return str
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
