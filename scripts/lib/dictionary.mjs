// Known titles for the rule-based extractor. Sources, all free:
//  - Wikipedia "List of <language> films of <year>" pages (no key needed)
//  - TMDB discover, when TMDB_API_KEY is set (adds series and more films)
//  - titles already seen in recent claims (added at run time, not stored)
import { fetchText } from './http.mjs';
import { INDIAN_LANGS, WANTED_LANGS } from './tmdb.mjs';
import { LANGUAGES, WANTED_INDIAN } from './languages.mjs';

const WIKI_LANGS = Object.fromEntries(WANTED_INDIAN.map((l) => [l, LANGUAGES[l]]));
const WIKI_UA = { 'user-agent': 'ott-radar/1.0 (https://github.com/tinyshelf/ott-radar)' };

function stripTemplates(wikitext) {
  let s = wikitext
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  // Nested {{...}} (citations, flags) — strip innermost first until none remain.
  for (let prev = ''; prev !== s;) {
    prev = s;
    s = s.replace(/\{\{[^{}]*\}\}/g, '');
  }
  return s;
}

// Film titles are the italicised cells of the list tables: ''[[Page|Title]]'' or ''Title''.
export function parseWikiFilmList(wikitext) {
  const titles = new Set();
  for (const line of stripTemplates(wikitext).split('\n')) {
    if (!/^\s*[|!]/.test(line)) continue;
    for (const m of line.matchAll(/(?<!')''(?!')\[\[([^\]|]+)(?:\|([^\]]+))?\]\](?<!')''(?!')/g)) {
      titles.add((m[2] ?? m[1]).replace(/\s*\([^)]*\b(?:film|series|movie)\)$/i, '').trim());
    }
    for (const m of line.matchAll(/(?<!')''(?!['[])([^'[\]{}|<>\n]{2,80}?)(?<!')''(?!')/g)) {
      titles.add(m[1].trim());
    }
  }
  return [...titles].filter((t) => t && !/^\d+$/.test(t));
}

async function wikipediaEntries(years) {
  const entries = [];
  for (const [language, name] of Object.entries(WIKI_LANGS)) {
    for (const year of years) {
      const page = `List of ${name} films of ${year}`;
      const url = `https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext&redirects=1&page=${encodeURIComponent(page)}`;
      try {
        const data = JSON.parse((await fetchText(url, { headers: WIKI_UA })).text);
        if (!data.parse?.wikitext) continue;
        const titles = parseWikiFilmList(data.parse.wikitext);
        for (const title of titles) entries.push({ title, language, type: 'movie', year, source: 'wikipedia' });
        console.log(`  wikipedia: ${page}: ${titles.length}`);
      } catch (err) {
        console.warn(`  ! wikipedia ${page}: ${err.message}`);
      }
    }
  }
  return entries;
}

async function tmdbEntries(tmdb, today) {
  const addDays = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
  const entries = [];
  const push = (r, type) => {
    const title = type === 'series' ? r.name : r.title;
    const original = type === 'series' ? r.original_name : r.original_title;
    const date = type === 'series' ? r.first_air_date : r.release_date;
    const base = { language: r.original_language, type, year: date ? Number(date.slice(0, 4)) : null, source: 'tmdb' };
    entries.push({ ...base, title });
    if (original && original !== title && /^[\p{Script=Latin}\d\s\W]+$/u.test(original)) entries.push({ ...base, title: original });
  };
  const streamingIN = { watch_region: 'IN', with_watch_monetization_types: 'flatrate|free|ads', with_original_language: WANTED_LANGS };
  // Indian films and series, released or upcoming.
  for (const r of await tmdb.discover('movie', { with_original_language: INDIAN_LANGS, 'release_date.gte': addDays(-240), 'release_date.lte': addDays(150), region: 'IN' }, 10)) push(r, 'movie');
  for (const r of await tmdb.discover('tv', { with_original_language: INDIAN_LANGS, 'first_air_date.gte': addDays(-365), 'first_air_date.lte': addDays(120) }, 6)) push(r, 'series');
  // Anything in the covered languages from the last year that streams in India.
  for (const r of await tmdb.discover('movie', { ...streamingIN, 'primary_release_date.gte': addDays(-365) }, 10)) push(r, 'movie');
  // Series with episodes airing now, including new seasons of older shows.
  for (const r of await tmdb.discover('tv', { ...streamingIN, 'air_date.gte': addDays(-120), 'air_date.lte': addDays(60) }, 10)) push(r, 'series');
  // Upcoming films whose OTT dates will be in the news later.
  for (const r of await tmdb.discover('movie', { region: 'IN', with_original_language: WANTED_LANGS, 'primary_release_date.gte': addDays(-30), 'primary_release_date.lte': addDays(120) }, 5)) push(r, 'movie');
  console.log(`  tmdb: ${entries.length} titles`);
  return entries;
}

// Bump when the sources above change so the stored list is rebuilt right away.
const DICT_VERSION = 3;

// Refreshes the stored title list at most once per day.
export async function refreshDictionary(stored, { today, tmdb }) {
  if (stored.fetched === today && stored.version === DICT_VERSION && stored.entries?.length) return stored;
  const year = Number(today.slice(0, 4));
  const entries = [...await wikipediaEntries([year - 1, year])];
  if (tmdb) {
    try {
      entries.push(...await tmdbEntries(tmdb, today));
    } catch (err) {
      console.warn(`  ! tmdb titles: ${err.message}`);
    }
  }
  // Keep the previous list if every source failed.
  if (!entries.length) return stored;
  return { fetched: today, version: DICT_VERSION, entries };
}
