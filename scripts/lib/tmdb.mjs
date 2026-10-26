import { normalizeTitle } from './text.mjs';

import { WANTED, WANTED_INDIAN } from './languages.mjs';

const BASE = 'https://api.themoviedb.org/3';
// TMDB "OR" lists of original languages.
export const INDIAN_LANGS = WANTED_INDIAN.join('|');
export const WANTED_LANGS = WANTED.join('|');
const INDIAN_SET = new Set(INDIAN_LANGS.split('|'));
// Bump when matching rules change so cached matches are redone.
export const MATCH_VERSION = 2;

// Accepts either a v3 API key or a v4 "API Read Access Token" (a JWT).
export function createTmdb(key) {
  const bearer = key.startsWith('eyJ');

  async function get(path, params = {}, attempt = 0) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    if (!bearer) url.searchParams.set('api_key', key);
    const res = await fetch(url, {
      headers: { accept: 'application/json', ...(bearer ? { authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      return get(path, params, attempt + 1);
    }
    if (!res.ok) throw new Error(`TMDB ${res.status} ${path}`);
    return res.json();
  }

  // `refYear` (the year the news appeared) stands in for an unknown release year:
  // OTT news is about recent films, not the famous namesake from decades ago.
  function score(result, { title, language, year, type, refYear }) {
    const names = type === 'series' ? [result.name, result.original_name] : [result.title, result.original_title];
    const target = normalizeTitle(title);
    const norm = names.filter(Boolean).map(normalizeTitle);
    let s = 0;
    if (norm.includes(target)) s += 4;
    else if (norm.some((n) => n.startsWith(target + ' ') || target.startsWith(n + ' '))) s += 1;
    else return -1;
    if (language ? result.original_language === language : INDIAN_SET.has(result.original_language)) s += 2;
    const date = type === 'series' ? result.first_air_date : result.release_date;
    const y = date ? Number(date.slice(0, 4)) : null;
    if (year && y && Math.abs(y - year) <= 1) s += 2;
    if (year && y && Math.abs(y - year) > 2) s -= 2;
    if (!year && refYear && y) {
      if (y >= refYear - 1 && y <= refYear + 1) s += 2;
      else if (y < refYear - 3) s -= 3;
    }
    return s + Math.min(result.popularity ?? 0, 50) / 100;
  }

  // Finds the TMDB entry for a news title. Returns { id, type } or null.
  async function match(query) {
    const path = query.type === 'series' ? '/search/tv' : '/search/movie';
    const yearParam = query.type === 'series' ? 'first_air_date_year' : 'year';
    const attempts = query.year ? [{ [yearParam]: query.year }, {}] : [{}];
    for (const extra of attempts) {
      const { results = [] } = await get(path, { query: query.title, region: 'IN', ...extra });
      const best = results
        .map((r) => ({ r, s: score(r, query) }))
        .filter((x) => x.s >= 4)
        .sort((a, b) => b.s - a.s)[0];
      if (best) return { id: best.r.id, type: query.type };
    }
    return null;
  }

  async function details(id, type) {
    if (type === 'series') {
      const d = await get(`/tv/${id}`, { append_to_response: 'watch/providers,aggregate_credits,external_ids' });
      return {
        tmdb_id: id, type, imdb_id: d.external_ids?.imdb_id || null,
        title: d.name, original_title: d.original_name, language: d.original_language,
        year: d.first_air_date ? Number(d.first_air_date.slice(0, 4)) : null,
        poster: d.poster_path ?? null, overview: d.overview || null,
        genres: (d.genres ?? []).map((g) => g.name),
        cast: (d.aggregate_credits?.cast ?? []).slice(0, 4).map((c) => c.name),
        director: (d.created_by ?? []).map((c) => c.name)[0] ?? null,
        theatrical: null, digital: [],
        providers: providersIN(d['watch/providers']),
      };
    }
    const d = await get(`/movie/${id}`, { append_to_response: 'release_dates,watch/providers,credits' });
    const inDates = (d.release_dates?.results ?? []).find((r) => r.iso_3166_1 === 'IN')?.release_dates ?? [];
    const theatrical = inDates.filter((r) => r.type === 3 || r.type === 2).map((r) => r.release_date.slice(0, 10)).sort()[0];
    return {
      tmdb_id: id, type, imdb_id: d.imdb_id || null,
      title: d.title, original_title: d.original_title, language: d.original_language,
      year: d.release_date ? Number(d.release_date.slice(0, 4)) : null,
      poster: d.poster_path ?? null, overview: d.overview || null,
      genres: (d.genres ?? []).map((g) => g.name),
      runtime: d.runtime || null,
      cast: (d.credits?.cast ?? []).slice(0, 4).map((c) => c.name),
      director: (d.credits?.crew ?? []).find((c) => c.job === 'Director')?.name ?? null,
      theatrical: theatrical ?? (d.release_date || null),
      digital: inDates.filter((r) => r.type === 4).map((r) => ({ date: r.release_date.slice(0, 10), note: r.note || null })),
      providers: providersIN(d['watch/providers']),
    };
  }

  async function discover(kind, params, pages = 1) {
    const results = [];
    for (let page = 1; page <= pages; page++) {
      const data = await get(`/discover/${kind}`, { sort_by: 'popularity.desc', ...params, page });
      results.push(...(data.results ?? []));
      if (page >= (data.total_pages ?? 1)) break;
    }
    return results;
  }

  // Indian-language films with a digital release date in India inside [from, to].
  async function discoverDigital(from, to, pages = 3) {
    // Only recent films: an old film newly added to a catalogue isn't an OTT release.
    const results = await discover('movie', {
      region: 'IN', with_release_type: 4,
      'release_date.gte': from, 'release_date.lte': to,
      'primary_release_date.gte': `${Number(from.slice(0, 4)) - 1}-01-01`,
      with_original_language: INDIAN_LANGS,
    }, pages);
    return results.map((r) => r.id);
  }

  return { match, details, discover, discoverDigital };
}

function providersIN(wp) {
  const r = wp?.results?.IN;
  if (!r) return [];
  // Subscription, ad-supported and free only; rent/buy isn't "on OTT".
  const names = [...(r.flatrate ?? []), ...(r.ads ?? []), ...(r.free ?? [])].map((p) => p.provider_name);
  return [...new Set(names)];
}
