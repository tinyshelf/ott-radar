// Data job: news feeds -> rule-based extraction -> TMDB enrichment -> data/releases.json.
// Everything it calls is free. TMDB_API_KEY (free) is optional but adds posters,
// series titles and current streaming availability.
//
//   node scripts/update.mjs                 full run
//   node scripts/update.mjs --offline       rebuild releases.json from stored data only
//   node scripts/update.mjs --collect=FILE  fetch feeds + articles, write them to FILE, stop
//   node scripts/update.mjs --dry=FILE      extract from a --collect file, print facts, stop
//   node scripts/update.mjs --from=FILE     full run, but read articles from a --collect file
//   node scripts/update.mjs --backfill=60   full run that also reads the last 60 days of news
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectHeadlines, fetchArticles, selectHeadlines } from './lib/collect.mjs';
import { commonWords, compileDictionary, extractFromArticle } from './lib/rules.mjs';
import { refreshDictionary } from './lib/dictionary.mjs';
import { createTmdb, MATCH_VERSION } from './lib/tmdb.mjs';
import { fetchRatings } from './lib/imdb.mjs';
import { mapPool } from './lib/http.mjs';
import { buildReleases, factToClaim, matchKey, tmdbClaims } from './lib/merge.mjs';
import { PLATFORMS } from './lib/platforms.mjs';
import { LANGUAGES, WANTED } from './lib/languages.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const OFFLINE = args.includes('--offline');
const COLLECT_TO = flag('collect');
const DRY_FROM = flag('dry');
const FROM = flag('from');
const BACKFILL_DAYS = Number(flag('backfill') || process.env.BACKFILL_DAYS || 0);
const MAX_ARTICLES = Number(process.env.MAX_ARTICLES || (BACKFILL_DAYS ? 500 : 100));

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const tmdb = process.env.TMDB_API_KEY ? createTmdb(process.env.TMDB_API_KEY) : null;

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(path.join(DATA, file), 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

// One record per line keeps git diffs of the data files readable.
async function writeLines(file, header, key, rows) {
  const body = rows.map((r) => '    ' + JSON.stringify(r)).join(',\n');
  const head = JSON.stringify(header).slice(1, -1);
  const text = `{${head ? `${head},` : ''}\n  "${key}": [\n${body}\n  ]\n}\n`;
  await fs.writeFile(path.join(DATA, file), text);
}

// Wikipedia/TMDB titles plus every title seen in the last 180 days of claims.
// One-word titles that are ordinary words in this batch of articles are dropped.
function buildDictionary(titles, claims, articles) {
  const recent = addDays(today, -180);
  const fromClaims = claims
    .filter((c) => c.seen >= recent)
    .map((c) => ({ title: c.title, language: c.language, type: c.type, year: c.year }));
  return compileDictionary([...fromClaims, ...titles.entries], { common: commonWords(articles.map((a) => a.text || '')) });
}

function extractAll(articles, dict) {
  const facts = [];
  for (const article of articles) {
    for (const f of extractFromArticle(article, dict, today)) facts.push({ ...f, article });
  }
  return facts;
}

async function stepNews(claims, seen, titles) {
  let articles;
  if (FROM) {
    articles = JSON.parse(await fs.readFile(FROM, 'utf8')).filter((a) => !seen[a.link]);
    console.log(`News: ${articles.length} unseen articles from ${FROM}`);
  } else {
    console.log(`News: collecting headlines${BACKFILL_DAYS ? ` (backfilling ${BACKFILL_DAYS} days)` : ''}`);
    const headlines = selectHeadlines(await collectHeadlines(seen, { backfillDays: BACKFILL_DAYS }), MAX_ARTICLES);
    console.log(`  ${headlines.length} new relevant headlines`);
    articles = (await fetchArticles(headlines)).filter(Boolean);
  }
  if (COLLECT_TO) {
    await fs.writeFile(COLLECT_TO, JSON.stringify(articles, null, 2));
    console.log(`  wrote ${articles.length} articles to ${COLLECT_TO}`);
    return false;
  }

  const known = new Set(claims.map((c) => c.id));
  let added = 0;
  articles = articles.filter((a) => !a.retry);
  for (const fact of extractAll(articles, buildDictionary(titles, claims, articles))) {
    const claim = factToClaim(fact, today);
    if (!claim.title || known.has(claim.id)) continue;
    known.add(claim.id);
    claims.push(claim);
    added++;
  }
  for (const a of articles) seen[a.link] = today;
  console.log(`  +${added} claims from ${articles.length} articles`);
  return true;
}

async function stepTmdb(claims, cache) {
  if (!tmdb) {
    console.log('TMDB: TMDB_API_KEY not set; skipping posters and availability');
    return;
  }
  console.log('TMDB: matching titles');
  const recent = addDays(today, -120);
  const queries = new Map();
  for (const c of claims) {
    if (c.seen < recent) continue;
    const k = matchKey(c);
    const prev = cache.matches[k];
    if (prev && prev.v === MATCH_VERSION && (prev.id || prev.at > addDays(today, -3))) continue;
    if (!queries.has(k)) queries.set(k, c);
  }
  await mapPool([...queries.entries()], 4, async ([k, c]) => {
    const m = await tmdb.match({ ...c, refYear: Number(c.seen.slice(0, 4)) });
    cache.matches[k] = { ...(m ?? { id: null }), at: today, v: MATCH_VERSION };
  });
  console.log(`  searched ${queries.size} titles`);

  const wanted = new Set();
  for (const c of claims) {
    const m = cache.matches[matchKey(c)];
    if (m?.id && c.seen >= recent) wanted.add(`${m.type}:${m.id}`);
  }
  try {
    const discovered = await tmdb.discoverDigital(addDays(today, -180), addDays(today, 90), 5);
    for (const id of discovered) wanted.add(`movie:${id}`);
    console.log(`  ${discovered.length} Indian films with digital dates via discover`);
  } catch (err) {
    console.warn(`  ! TMDB discover failed: ${err.message}`);
  }

  // Entries cached before IMDb ids were collected have no imdb_id key at all.
  const stale = [...wanted].filter((k) => {
    const d = cache.details[k];
    return !d || d.imdb_id === undefined || d.fetched_at.slice(0, 10) < addDays(today, -2);
  }).slice(0, 400);
  await mapPool(stale, 4, async (k) => {
    const [type, id] = k.split(':');
    cache.details[k] = { ...(await tmdb.details(Number(id), type)), fetched_at: new Date().toISOString() };
  });
  console.log(`  refreshed ${stale.length} TMDB entries`);
}

async function stepImdb(cache, imdb) {
  const ids = new Set(Object.values(cache.details).map((d) => d.imdb_id).filter(Boolean));
  if (!ids.size) return imdb;
  console.log(`IMDb: ratings for ${ids.size} titles`);
  try {
    const ratings = await fetchRatings(ids);
    console.log(`  ${Object.keys(ratings).length} rated`);
    return { fetched: today, ratings };
  } catch (err) {
    console.warn(`  ! IMDb ratings: ${err.message}; keeping previous ratings`);
    return imdb;
  }
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  const claims = (await readJson('claims.json', { claims: [] })).claims;
  const seen = await readJson('seen.json', {});
  const cache = await readJson('tmdb.json', { matches: {}, details: {} });
  let titles = await readJson('titles.json', { fetched: null, entries: [] });
  let imdb = await readJson('imdb.json', { fetched: null, ratings: {} });

  if (DRY_FROM) {
    titles = await refreshDictionary(titles, { today, tmdb });
    const articles = JSON.parse(await fs.readFile(DRY_FROM, 'utf8'));
    for (const f of extractAll(articles, buildDictionary(titles, claims, articles))) {
      const { article, ...rest } = f;
      console.log(JSON.stringify({ ...rest, outlet: article.outlet, headline: article.title.slice(0, 70) }));
    }
    return;
  }

  if (!OFFLINE) {
    console.log('Titles: refreshing known-title list');
    titles = await refreshDictionary(titles, { today, tmdb });
    console.log(`  ${titles.entries.length} titles`);
    const keepGoing = await stepNews(claims, seen, titles);
    if (!keepGoing) return;
    await stepTmdb(claims, cache);
    imdb = await stepImdb(cache, imdb);
  }

  // TMDB-only entries (no news about them) count only for recent films; the news
  // decides for everything else.
  const referenced = new Set(claims.map((c) => cache.matches[matchKey(c)]).filter((m) => m?.id).map((m) => `${m.type}:${m.id}`));
  const minYear = Number(today.slice(0, 4)) - 1;
  const derived = Object.entries(cache.details)
    .filter(([key, d]) => referenced.has(key) || (d.year ?? 0) >= minYear)
    .flatMap(([, d]) => tmdbClaims(d));
  const releases = buildReleases([...claims, ...derived], { ...cache, ratings: imdb.ratings }, today)
    .filter((r) => WANTED.includes(r.language));
  console.log(`Built ${releases.length} releases from ${claims.length} news claims + ${derived.length} TMDB claims`);

  for (const [link, day] of Object.entries(seen)) if (day < addDays(today, -30)) delete seen[link];
  claims.sort((a, b) => a.seen.localeCompare(b.seen) || a.id.localeCompare(b.id));

  await writeLines('claims.json', {}, 'claims', claims);
  await writeLines('titles.json', { fetched: titles.fetched, version: titles.version }, 'entries', titles.entries);
  await fs.writeFile(path.join(DATA, 'seen.json'), JSON.stringify(seen, null, 1) + '\n');
  await fs.writeFile(path.join(DATA, 'tmdb.json'), JSON.stringify(cache) + '\n');
  await fs.writeFile(path.join(DATA, 'imdb.json'), JSON.stringify(imdb) + '\n');
  const platforms = Object.fromEntries(Object.entries(PLATFORMS).map(([id, p]) => [id, { name: p.name, color: p.color, url: p.url }]));
  const languages = Object.fromEntries(WANTED.map((l) => [l, LANGUAGES[l]]));
  await writeLines('releases.json', { updated_at: new Date().toISOString(), today, platforms, languages }, 'releases', releases);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
