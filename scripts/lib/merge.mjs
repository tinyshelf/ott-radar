import { platformId, normalizePlatformName, PLATFORMS } from './platforms.mjs';
import { languageCode } from './languages.mjs';
import { normalizeTitle, shortHash, slugify } from './text.mjs';

const DAY = 86400e3;
// Reports older than this, relative to the newest report for the same
// title+platform, are ignored when picking a date (handles postponements).
const RECENCY_WINDOW_DAYS = 21;
const IMG = 'https://image.tmdb.org/t/p/w342';

const DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;

export function cleanDate(value) {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return null;
  const full = value.length === 7 ? `${value}-01` : value;
  const d = new Date(`${full}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === full ? value : null;
}

function canonicalPlatform(raw) {
  if (!raw) return null;
  return platformId(raw) ?? `x-${slugify(normalizePlatformName(raw))}`;
}

export function matchKey(c) {
  return `${normalizeTitle(c.title)}|${c.language ?? ''}|${c.type}`;
}

// Converts one Claude-extracted fact into a stored claim.
export function factToClaim(fact, seenOn) {
  const a = fact.article;
  const platform = canonicalPlatform(fact.platform);
  const claim = {
    title: String(fact.title).trim(),
    type: fact.type === 'series' ? 'series' : 'movie',
    language: languageCode(fact.language),
    year: Number.isInteger(fact.year) ? fact.year : null,
    platform,
    platform_name: platform && !PLATFORMS[platform] ? fact.platform : undefined,
    date: cleanDate(fact.date),
    certainty: ['official', 'reported', 'speculative'].includes(fact.certainty) ? fact.certainty : 'reported',
    available: platform && fact.streaming_now === true ? true : undefined,
    outlet: a.outlet,
    url: a.url,
    headline: a.title,
    published: a.published ?? `${seenOn}T00:00:00.000Z`,
    seen: seenOn,
  };
  claim.id = shortHash(claim.url, normalizeTitle(claim.title), claim.platform ?? '', claim.date ?? '');
  return claim;
}

// Claims derived from cached TMDB details: digital release dates (community
// edited) and current India availability (JustWatch data via TMDB).
export function tmdbClaims(details) {
  const out = [];
  const page = `https://www.themoviedb.org/${details.type === 'series' ? 'tv' : 'movie'}/${details.tmdb_id}`;
  const providerIds = [...new Set(details.providers.map(canonicalPlatform))];
  const base = {
    tmdb: `${details.type}:${details.tmdb_id}`, title: details.title, type: details.type,
    language: details.language, year: details.year, url: page,
    published: details.fetched_at, seen: details.fetched_at?.slice(0, 10),
  };
  for (const d of details.digital ?? []) {
    let platform = canonicalPlatform(d.note);
    if (platform?.startsWith('x-')) platform = null;
    if (!platform && providerIds.length === 1) platform = providerIds[0];
    if (!platform) continue;
    out.push({ ...base, id: shortHash(page, 'digital', platform, d.date), platform, date: cleanDate(d.date), certainty: 'reported', outlet: 'TMDB' });
  }
  for (const platform of providerIds) {
    out.push({ ...base, id: shortHash(page, 'available', platform), platform, date: null, certainty: 'official', available: true, outlet: 'JustWatch' });
  }
  return out;
}

const ts = (c) => Date.parse(c.published ?? c.seen) || 0;
const compatible = (day, month) => day.startsWith(month + '-');

// Picks a date and confidence for one title+platform from its claims.
export function resolveStream(claims, today) {
  const available = claims.some((c) => c.available);
  let dated = claims.filter((c) => c.date);
  let date = null;
  let conflicts = [];
  let support = [];

  if (dated.length) {
    const newest = Math.max(...dated.map(ts));
    dated = dated.filter((c) => ts(c) >= newest - RECENCY_WINDOW_DAYS * DAY);
    const official = dated.filter((c) => c.certainty === 'official');
    const pool = official.length ? official : dated;

    const candidates = [...new Set(pool.map((c) => c.date))].map((d) => {
      const backers = dated.filter((c) => c.date === d || (d.length === 10 && compatible(d, c.date)));
      return {
        date: d,
        backers,
        outlets: new Set(backers.map((c) => c.outlet)).size,
        latest: Math.max(...backers.filter((c) => c.date === d).map(ts)),
      };
    });
    candidates.sort((a, b) =>
      (b.outlets - a.outlets) || (b.date.length - a.date.length) || (b.latest - a.latest));
    const best = candidates[0];
    date = best.date;
    support = best.backers;
    // Other dates are shown only when they have real backing, not one stray report
    // against a dozen agreeing ones.
    const minOutlets = best.outlets >= 3 ? Math.max(2, Math.ceil(best.outlets * 0.4)) : 1;
    conflicts = [...new Set(dated.map((c) => c.date))].filter((d) => {
      if (d === date || (date.length === 10 && compatible(date, d)) || (d.length === 10 && compatible(d, date))) return false;
      return new Set(dated.filter((c) => c.date === d).map((c) => c.outlet)).size >= minOutlets;
    });
  } else {
    support = claims;
  }

  const supportOutlets = new Set(support.map((c) => c.outlet)).size;
  let status;
  if (support.some((c) => c.certainty === 'official') || supportOutlets >= 2 || (available && (!date || date <= today))) {
    status = 'confirmed';
  } else if (support.length && support.every((c) => c.certainty === 'speculative')) {
    status = 'rumored';
  } else {
    status = 'reported';
  }
  if (date && date.length === 7 && status === 'confirmed' && !support.some((c) => c.certainty === 'official')) {
    status = 'reported';
  }

  const sources = [...new Map(claims
    .filter((c) => c.outlet !== 'JustWatch')
    .sort((a, b) => ts(b) - ts(a))
    .map((c) => [c.url, { outlet: c.outlet, url: c.url, headline: c.headline, published: c.published, date: c.date, certainty: c.certainty }])).values()].slice(0, 8);

  return {
    date,
    precision: date ? (date.length === 7 ? 'month' : 'day') : null,
    status,
    available: available || (status === 'confirmed' && !!date && date.length === 10 && date <= today),
    conflicts,
    outlets: newsOutlets(claims),
    first_seen: new Date(Math.min(...claims.map(ts))).toISOString().slice(0, 10),
    sources,
  };
}

const newsOutlets = (cs) => new Set(cs.filter((c) => c.outlet !== 'JustWatch').map((c) => c.outlet)).size;

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) if (v != null) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// Groups all claims into releases for the site.
// `matches` maps matchKey -> { id, type } | null; `details` maps "type:id" -> TMDB details;
// `ratings` maps IMDb id -> [rating, votes].
export function buildReleases(claims, { matches = {}, details = {}, ratings = {} } = {}, today) {
  const groups = new Map();
  for (const c of claims) {
    const m = c.tmdb ? null : matches[matchKey(c)];
    const key = c.tmdb ?? (m?.id ? `${m.type}:${m.id}` : `t:${normalizeTitle(c.title)}|${c.type}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const releases = [];
  for (const [key, group] of groups) {
    const info = details[key] ?? null;
    const byPlatform = new Map();
    const unassigned = [];
    for (const c of group) {
      if (!c.platform) unassigned.push(c);
      else {
        if (!byPlatform.has(c.platform)) byPlatform.set(c.platform, []);
        byPlatform.get(c.platform).push(c);
      }
    }
    // Platforms named by far fewer outlets than the main one are usually a
    // neighbouring title's platform picked up by mistake. JustWatch availability
    // is kept regardless.
    const top = Math.max(0, ...[...byPlatform.values()].map(newsOutlets));
    for (const [platform, cs] of byPlatform) {
      if (!cs.some((c) => c.outlet === 'JustWatch') && newsOutlets(cs) < Math.max(1, Math.ceil(top * 0.3))) byPlatform.delete(platform);
    }
    // A date reported without a platform belongs to the only known platform.
    if (byPlatform.size === 1) [...byPlatform.values()][0].push(...unassigned.filter((c) => c.date));
    else if (byPlatform.size === 0 && unassigned.some((c) => c.date)) byPlatform.set(null, unassigned);

    let streams = [...byPlatform.entries()].map(([platform, cs]) => ({
      platform,
      platform_name: platform && !PLATFORMS[platform] ? mostCommon(cs.map((c) => c.platform_name)) : undefined,
      ...resolveStream(cs, today),
    }));
    if (streams.some((s) => s.status !== 'rumored')) streams = streams.filter((s) => s.status !== 'rumored');
    if (!streams.length) continue;
    streams.sort((a, b) => String(a.date ?? '9999').localeCompare(String(b.date ?? '9999')));

    const newsClaims = group.filter((c) => !c.tmdb);
    const title = info?.title ?? mostCommon(newsClaims.map((c) => c.title)) ?? group[0].title;
    releases.push({
      id: info ? key.replace(':', '-') : `${slugify(title)}-${shortHash(key).slice(0, 6)}`,
      title,
      original_title: info?.original_title && info.original_title !== title ? info.original_title : undefined,
      type: info?.type ?? mostCommon(group.map((c) => c.type)) ?? 'movie',
      language: info?.language ?? mostCommon(group.map((c) => c.language)),
      year: info?.year ?? mostCommon(group.map((c) => c.year)),
      poster: info?.poster ? IMG + info.poster : null,
      overview: info?.overview ?? null,
      genres: info?.genres ?? [],
      cast: info?.cast ?? [],
      director: info?.director ?? null,
      theatrical: info?.theatrical ?? null,
      tmdb: info ? `https://www.themoviedb.org/${info.type === 'series' ? 'tv' : 'movie'}/${info.tmdb_id}` : null,
      imdb: info?.imdb_id ? { id: info.imdb_id, rating: ratings[info.imdb_id]?.[0] ?? null, votes: ratings[info.imdb_id]?.[1] ?? null } : null,
      streams,
    });
  }
  return releases.sort((a, b) => a.title.localeCompare(b.title));
}
