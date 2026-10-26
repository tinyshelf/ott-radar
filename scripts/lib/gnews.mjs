import { fetchText } from './http.mjs';

// Google News RSS links (news.google.com/rss/articles/<id>) are opaque redirects.
// The publisher URL is recovered the same way the Google News web app does it:
// read the article page's signature + timestamp, then call batchexecute.
// This is undocumented and may break; callers fall back to headline-only data.
// Calls are spaced out, and after one rate-limit response the rest of the run
// skips decoding rather than hammering Google.
const MIN_INTERVAL_MS = 1200;
let queue = Promise.resolve();
let blocked = false;

function throttled(fn) {
  const run = queue.then(async () => {
    if (blocked) throw new Error('Google News rate limit hit earlier in this run');
    try {
      return await fn();
    } catch (err) {
      if (/HTTP 429/.test(err.message)) blocked = true;
      throw err;
    } finally {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS));
    }
  });
  queue = run.catch(() => {});
  return run;
}

export function decodeGoogleNewsUrl(link) {
  return throttled(() => decode(link));
}

async function decode(link) {
  const id = new URL(link).pathname.split('/').pop();
  const { text: page } = await fetchText(`https://news.google.com/articles/${id}`);
  const sg = page.match(/data-n-a-sg="([^"]+)"/)?.[1];
  const ts = page.match(/data-n-a-ts="([^"]+)"/)?.[1];
  if (!sg || !ts) throw new Error('Google News page had no signature');

  const inner = JSON.stringify([
    'garturlreq',
    [['X', 'X', ['X', 'X'], null, null, 1, 1, 'US:en', null, 1, null, null, null, null, null, 0, 1], 'X', 'X', 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0],
    id, Number(ts), sg,
  ]);
  const { text } = await fetchText('https://news.google.com/_/DotsSplashUi/data/batchexecute', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'f.req=' + encodeURIComponent(JSON.stringify([[['Fbv4je', inner, null, 'generic']]])),
  });
  const payload = JSON.parse(text.split('\n\n')[1]);
  const url = JSON.parse(payload[0][2])[1];
  if (!/^https?:\/\//.test(url)) throw new Error('Google News decode returned no URL');
  return url;
}

export function googleNewsSearchUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}
