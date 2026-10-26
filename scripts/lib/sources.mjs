import { googleNewsSearchUrl } from './gnews.mjs';

// Publisher feeds that link straight to articles (checked Oct 2026).
// OTTplay and Binged block or no longer publish feeds; Google News covers them.
export const DIRECT_FEEDS = [
  { outlet: '123telugu', url: 'https://www.123telugu.com/feed' },
  { outlet: 'Koimoi', url: 'https://www.koimoi.com/feed/' },
  { outlet: 'Pinkvilla', url: 'https://www.pinkvilla.com/rss.xml' },
  { outlet: 'The Indian Express', url: 'https://indianexpress.com/section/entertainment/feed/' },
  { outlet: 'News18', url: 'https://www.news18.com/rss/movies.xml' },
  { outlet: 'India Today', url: 'https://www.indiatoday.in/rss/1206578' },
  { outlet: 'Bollywood Hungama', url: 'https://www.bollywoodhungama.com/feed/' },
  { outlet: 'Cinema Express', url: 'https://www.cinemaexpress.com/feed' },
  { outlet: 'Only Kollywood', url: 'https://www.onlykollywood.com/feed/' },
  { outlet: 'Mirchi9', url: 'https://www.mirchi9.com/feed/' },
  { outlet: 'Telugu360', url: 'https://www.telugu360.com/feed/' },
];

// Google News India searches.
const GNEWS_QUERIES = [
  '"OTT release date"',
  '"OTT releases this week"',
  '"OTT release" Tamil',
  '"OTT release" Telugu',
  '"OTT release" Malayalam',
  '"OTT release" Kannada',
  '"OTT release" Hindi',
  '"digital premiere" OR "world digital premiere"',
  'Netflix "OTT release"',
  '"Prime Video" "OTT release"',
  'JioHotstar "streaming from" OR "OTT release"',
  'ZEE5 OR SonyLIV "OTT release" OR premiere',
  'aha OR "Sun NXT" OR ManoramaMAX OR "ETV Win" OTT release',
  '"OTT release" Hollywood OR English',
  '"new on Netflix" OR "new on Prime Video" OR "new on JioHotstar"',
  '"web series" "streaming from" OR "OTT release"',
];

// `range` is a Google News time filter: "when:7d" for normal runs, or
// "after:YYYY-MM-DD before:YYYY-MM-DD" windows when backfilling older news.
export function gnewsFeeds(range = 'when:7d') {
  return GNEWS_QUERIES.map((q) => ({ outlet: null, url: googleNewsSearchUrl(`${q} ${range}`) }));
}

// Headline filter applied before any article is fetched.
export const RELEVANT = /\bOTT\b|\bstream(ing|s)?\b|digital (premiere|release|debut|rights)|where to watch|watch online|\bnetflix\b|prime video|jiohotstar|hotstar|\bzee5\b|sony ?liv|\baha\b|sun ?nxt|manorama ?max|etv win|hoichoi|apple tv|mx player|premieres? on/i;

// Weekly round-ups name many titles per article, so they are processed first.
export const ROUNDUP = /this week|this weekend|releases (on|this|of the week)|new (ott|releases)|titles? to watch|\b\d+ new\b|(movies|shows) (on|to watch)/i;
