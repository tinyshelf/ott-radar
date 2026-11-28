import { platformId, normalizePlatformName, PLATFORMS } from './platforms.mjs';
import { languageCode } from './languages.mjs';
import { normalizeTitle, shortHash, slugify } from './text.mjs';
import { searchTitle } from './tmdb.mjs';
import { tidyTitle } from './rules.mjs';

const DAY = 86400e3;
// Reports older than this, relative to the newest report for the same
// title+platform, are ignored when picking a date (handles postponements).
const RECENCY_WINDOW_DAYS = 21;
const IMG = 'https://image.tmdb.org/t/p/w342';
// "Out now" covers OTT releases from this many days back.
const OUT_NOW_DAYS = 90;
// Indian films reach OTT four to eight weeks after cinemas, never within two.
// An earlier streaming date is almost always the cinema date misread: round-ups
// list both kinds of release, and "OTT rights" stories quote the cinema date.
export const MIN_CINEMA_GAP_DAYS = 14;
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

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
    // On equal backing, an exact day beats the month it falls in; otherwise the
    // newer report wins, as it may be a postponement.
    const related = (x, y) => compatible(x, y) || compatible(y, x);
    candidates.sort((a, b) => (b.outlets - a.outlets)
      || (related(a.date, b.date) ? b.date.length - a.date.length : 0)
      || (b.latest - a.latest));
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

  // A streaming date still to come outranks "available" signals: JustWatch lists
  // a show's older seasons, and "now streaming" lines can be about another film.
  const upcoming = !!date && (date.length === 10 ? date > today : date > today.slice(0, 7));
  return {
    date,
    precision: date ? (date.length === 7 ? 'month' : 'day') : null,
    status,
    available: !upcoming && (available || (status === 'confirmed' && !!date && date.length === 10 && date <= today)),
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

// The site lists upcoming and recent releases. A release stays while one of its
// streams is upcoming or came out in the last OUT_NOW_DAYS. A stream without a
// date counts by when the news first reported it. JustWatch alone lists whole back
// catalogues, so it counts only for a film from this year or last with no OTT date.
export function isCurrent(release, today, days = OUT_NOW_DAYS) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);
  const dated = release.streams.filter((s) => s.date);
  if (dated.some((s) => (s.date.length === 7 ? s.date >= since.slice(0, 7) : s.date >= since))) return true;
  const undated = release.streams.filter((s) => !s.date && s.first_seen >= since);
  if (undated.some((s) => s.sources.length > 0)) return true;
  return !dated.length && (release.year ?? 0) >= Number(today.slice(0, 4)) - 1 && undated.length > 0;
}

// One title, one match. The match cache is keyed by title, language and type as
// guessed from each article, so a stray "Korean" in a round-up, or a series the
// articles call a film, gives a title a key of its own that may have found
// nothing. Such a claim joins the match another key found for the same title,
// unless several titles share the name or one side is English and the other isn't
// ("Law and Order" the Malayalam film).
function titleMatches(matches, details) {
  const byTitle = new Map();
  for (const [k, m] of Object.entries(matches)) {
    if (!m?.id) continue;
    const title = k.split('|')[0];
    if (!byTitle.has(title)) byTitle.set(title, new Set());
    byTitle.get(title).add(`${m.type}:${m.id}`);
  }
  return (c) => {
    const ids = byTitle.get(normalizeTitle(c.title));
    if (ids?.size !== 1) return null;
    const [id] = ids;
    const lang = details[id]?.language;
    if (c.language && lang && c.language !== lang && (c.language === 'en' || lang === 'en')) return null;
    return id;
  };
}

// Drops streaming dates (and "now streaming" claims) that fall before a film's
// cinema release plus MIN_CINEMA_GAP_DAYS, unless something independent backs
// them: JustWatch lists the film on that platform, TMDB has that digital date, or
// three outlets agree. Direct-to-OTT films have no cinema date, or are backed.
function plausibleAfterCinema(group, info, implausible) {
  const cinema = info.cinema !== undefined ? info.cinema : info.theatrical;
  if (!cinema || info.type === 'series') return group;
  const earliest = addDays(cinema, MIN_CINEMA_GAP_DAYS);
  const tooEarly = (d) => (d.length === 7 ? d < earliest.slice(0, 7) : d < earliest);
  const justWatch = new Set(group.filter((c) => c.outlet === 'JustWatch').map((c) => c.platform));
  const digital = new Set((info.digital ?? []).map((d) => d.date));
  const outletsFor = (date) => newsOutlets(group.filter((c) => !c.tmdb && c.date === date));
  const backed = (c) => justWatch.has(c.platform) || (!c.platform && justWatch.size > 0)
    || (!!c.date && (digital.has(c.date) || outletsFor(c.date) >= 3));
  return group.map((c) => {
    if (c.tmdb) return c;
    const early = c.date ? tooEarly(c.date) : c.available && tooEarly(String(c.published ?? c.seen).slice(0, 10));
    if (!early || backed(c)) return c;
    implausible?.push({ title: info.title, platform: c.platform, date: c.date, cinema, outlet: c.outlet });
    return { ...c, date: null, available: undefined };
  });
}

// Groups all claims into releases for the site.
// `matches` maps matchKey -> { id, type } | null; `details` maps "type:id" -> TMDB details;
// `ratings` maps IMDb id -> [rating, votes]. With `known` (normalized titles from
// Wikipedia/TMDB lists), a title with no TMDB match is kept only if it is a known
// title or two outlets report it: one outlet alone is usually a misread headline.
// `audit`, if given, collects what was left out: { implausible: [claim info],
// unverified: [release] }.
export function buildReleases(claims, { matches = {}, details = {}, ratings = {}, known = null, audit = null } = {}, today) {
  const shared = titleMatches(matches, details);
  const groups = new Map();
  for (const c of claims) {
    const m = c.tmdb ? null : matches[matchKey(c)];
    const key = c.tmdb ?? (m?.id ? `${m.type}:${m.id}` : shared(c) ?? `t:${normalizeTitle(c.title)}|${c.type}`);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }

  const releases = [];
  for (const [key, rawGroup] of groups) {
    const info = details[key] ?? null;
    const group = info ? plausibleAfterCinema(rawGroup, info, audit?.implausible) : rawGroup;
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
    const type = info?.type ?? mostCommon(group.map((c) => c.type)) ?? 'movie';
    const unverified = !info && known && newsOutlets(newsClaims) < 2
      && !known.has(normalizeTitle(title)) && !known.has(normalizeTitle(searchTitle({ title, type })));
    const release = {
      id: info ? key.replace(':', '-') : `${slugify(title)}-${shortHash(key).slice(0, 6)}`,
      title,
      original_title: info?.original_title && info.original_title !== title ? info.original_title : undefined,
      type,
      language: info?.language ?? mostCommon(group.map((c) => c.language)),
      year: info?.year ?? mostCommon(group.map((c) => c.year)),
      poster: info?.poster ? IMG + info.poster : null,
      overview: info?.overview ?? null,
      genres: info?.genres ?? [],
      cast: info?.cast ?? [],
      director: info?.director ?? null,
      // TMDB's fallback date is the streaming date for a direct-to-OTT film.
      theatrical: (info?.cinema !== undefined ? info.cinema : info?.theatrical) ?? null,
      tmdb: info ? `https://www.themoviedb.org/${info.type === 'series' ? 'tv' : 'movie'}/${info.tmdb_id}` : null,
      imdb: info?.imdb_id ? { id: info.imdb_id, rating: ratings[info.imdb_id]?.[0] ?? null, votes: ratings[info.imdb_id]?.[1] ?? null } : null,
      streams,
    };
    if (unverified) audit?.unverified.push(release);
    else releases.push(release);
  }
  return releases.sort((a, b) => a.title.localeCompare(b.title));
}

// Saved titles are stored by release id, and an id changes when a title gets (or
// changes) its TMDB match. Maps each id that disappeared to the release that now
// carries the same title, so the site can move saved titles across.
export function movedIds(previous, releases) {
  const current = new Set(releases.map((r) => r.id));
  const byTitle = new Map();
  for (const r of releases) {
    const k = normalizeTitle(r.title);
    if (!byTitle.has(k)) byTitle.set(k, []);
    byTitle.get(k).push(r);
  }
  const find = (r) => {
    for (const title of [r.title, tidyTitle(r.title)].filter(Boolean)) {
      const hits = byTitle.get(normalizeTitle(title)) ?? [];
      const pick = hits.length === 1 ? hits : hits.filter((h) => h.type === r.type);
      if (pick.length === 1) return pick[0].id;
    }
    return null;
  };
  const now = {};
  for (const r of previous.releases ?? []) {
    if (current.has(r.id)) continue;
    const to = find(r);
    if (to) now[r.id] = to;
  }
  const moved = {};
  for (const [from, to] of Object.entries(previous.moved ?? {})) {
    const target = current.has(to) ? to : now[to];
    if (target && !current.has(from)) moved[from] = target;
  }
  return { ...moved, ...now };
}
