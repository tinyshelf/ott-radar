import { fetchText, mapPool } from './http.mjs';
import { parseRss } from './rss.mjs';
import { decodeGoogleNewsUrl } from './gnews.mjs';
import { extractArticleText, normalizeTitle } from './text.mjs';
import { DIRECT_FEEDS, gnewsFeeds, RELEVANT, ROUNDUP } from './sources.mjs';

const MAX_AGE_DAYS = 10;
const MAX_TEXT_CHARS = 30000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function outletFromHost(url) {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, '');
  } catch {
    return 'unknown';
  }
}

// Fetches every feed and returns relevant, unseen headlines (no article bodies yet).
// With `backfillDays`, Google News is also searched week by week that far back.
export async function collectHeadlines(seen, { now = new Date(), backfillDays = 0 } = {}) {
  const feeds = [...DIRECT_FEEDS, ...gnewsFeeds()];
  for (let back = 7; back < backfillDays; back += 7) {
    const before = isoDay(now.getTime() - back * 86400e3);
    const after = isoDay(now.getTime() - (back + 7) * 86400e3);
    feeds.push(...gnewsFeeds(`after:${after} before:${before}`));
  }
  const results = await mapPool(feeds, backfillDays ? 2 : 4, async (feed) => {
    const { text } = await fetchText(feed.url);
    return parseRss(text).map((item) => ({ ...item, feedOutlet: feed.outlet }));
  });

  const cutoff = now.getTime() - (Math.max(backfillDays, 0) + MAX_AGE_DAYS) * 86400e3;
  const byKey = new Map();
  for (const item of results.flat().filter(Boolean)) {
    if (!item.link || seen[item.link]) continue;
    if (item.published && Date.parse(item.published) < cutoff) continue;
    const outlet = item.feedOutlet ?? item.source?.name ?? outletFromHost(item.link);
    // Google News appends " - Outlet" to every headline.
    const title = item.source?.name && item.title.endsWith(` - ${item.source.name}`)
      ? item.title.slice(0, -(item.source.name.length + 3))
      : item.title;
    if (!RELEVANT.test(title)) continue;
    const key = `${outlet}|${normalizeTitle(title)}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      link: item.link,
      title,
      outlet,
      published: item.published,
      feedText: item.content || '',
      roundup: ROUNDUP.test(title),
    });
  }
  return [...byKey.values()].sort((a, b) => String(b.published).localeCompare(String(a.published)));
}

// Round-ups mostly repeat the current week, while single-title stories carry the
// upcoming dates, so round-ups get at most a third of each run's budget.
export function selectHeadlines(headlines, max) {
  const roundups = headlines.filter((h) => h.roundup).slice(0, Math.ceil(max / 3));
  const singles = headlines.filter((h) => !h.roundup).slice(0, max - roundups.length);
  const extra = headlines.filter((h) => h.roundup).slice(roundups.length, roundups.length + max - roundups.length - singles.length);
  return [...roundups, ...singles, ...extra];
}

// Resolves Google News redirects and fetches article text. Articles that can't be
// fetched are still returned with just the headline, which is often enough.
export async function fetchArticles(headlines) {
  return mapPool(headlines, 4, async (h) => {
    let url = h.link;
    let text = h.feedText.length > 500 ? h.feedText : '';
    let retry = false;
    try {
      if (url.includes('news.google.com/')) url = await decodeGoogleNewsUrl(url);
      if (!text) text = extractArticleText((await fetchText(url)).text);
    } catch (err) {
      // Rate limits are temporary: leave the article unseen so the next run retries it.
      retry = /429|rate limit/i.test(err.message);
      console.warn(`  ! ${h.outlet}: ${err.message.slice(0, 120)}`);
    }
    // Very long pages are mostly site chrome; the article is near the top.
    return { ...h, url, text: text.slice(0, MAX_TEXT_CHARS), retry };
  });
}
