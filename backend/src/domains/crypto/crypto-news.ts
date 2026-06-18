import type { Logger } from '@infras/logger/logger';

// A few reliable crypto RSS sources. Fetched server-side (browsers can't read RSS
// cross-origin) and merged newest-first.
const FEEDS = [
  { source: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { source: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { source: 'Decrypt', url: 'https://decrypt.co/feed' },
];

const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CryptoNewsItem {
  title: string;
  link: string;
  description: string;
  published: string | null; // ISO
  source: string;
  image: string | null;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
};

function decode(s: string): string {
  return s
    .replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&apos;/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function unwrapCdata(s: string): string {
  const m = s.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return m ? m[1] : s;
}

function tagText(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? decode(unwrapCdata(m[1]).trim()) : '';
}

function stripTags(s: string): string {
  return decode(unwrapCdata(s))
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function imageFrom(block: string): string | null {
  const media = block.match(/<media:(?:content|thumbnail)[^>]*url="([^"]+)"/i);
  if (media) return media[1];
  const enc = block.match(/<enclosure[^>]*url="([^"]+)"[^>]*type="image/i);
  if (enc) return enc[1];
  const img = block.match(/<img[^>]*src="([^"]+)"/i);
  return img ? img[1] : null;
}

function toIso(raw: string): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function parseFeed(xml: string, source: string): CryptoNewsItem[] {
  const out: CryptoNewsItem[] = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  for (const b of blocks) {
    const title = tagText(b, 'title');
    let link = tagText(b, 'link');
    if (!link) link = b.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? ''; // atom-style
    if (!title || !link) continue;
    out.push({
      title,
      link,
      description: stripTags(tagText(b, 'description') || tagText(b, 'summary')).slice(0, 200),
      published: toIso(tagText(b, 'pubDate') || tagText(b, 'dc:date') || tagText(b, 'published')),
      source,
      image: imageFrom(b),
    });
  }
  return out;
}

export function createCryptoNews(deps: { logger: Logger }) {
  const { logger } = deps;
  let cache: { data: CryptoNewsItem[]; expiresAt: number } | null = null;

  async function fetchOne(feed: (typeof FEEDS)[number]): Promise<CryptoNewsItem[]> {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ShekaBot/1.0)' },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        logger.warn({ url: feed.url, status: res.status }, 'crypto RSS fetch failed');
        return [];
      }
      return parseFeed(await res.text(), feed.source);
    } catch (err) {
      logger.warn(
        { url: feed.url, error: err instanceof Error ? err.message : String(err) },
        'crypto RSS error',
      );
      return [];
    }
  }

  // Merged, deduped (by link), newest-first crypto headlines. 5-min in-memory cache.
  async function fetchNews(limit = 24): Promise<CryptoNewsItem[]> {
    if (cache && cache.expiresAt > Date.now()) return cache.data.slice(0, limit);
    const all = (await Promise.all(FEEDS.map(fetchOne))).flat();
    const seen = new Set<string>();
    const merged = all
      .filter((a) => {
        if (seen.has(a.link)) return false;
        seen.add(a.link);
        return true;
      })
      .sort((a, b) => new Date(b.published ?? 0).getTime() - new Date(a.published ?? 0).getTime());
    if (merged.length > 0) cache = { data: merged, expiresAt: Date.now() + CACHE_TTL_MS };
    return merged.slice(0, limit);
  }

  return { fetchNews };
}

export type CryptoNews = ReturnType<typeof createCryptoNews>;
