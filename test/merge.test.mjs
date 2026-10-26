import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReleases, cleanDate, factToClaim, resolveStream, tmdbClaims } from '../scripts/lib/merge.mjs';

const TODAY = '2026-10-25';
let n = 0;
const claim = (over) => ({
  id: `c${n++}`, title: 'Gajab Raat', type: 'movie', language: 'hi', year: 2026,
  platform: 'netflix', date: '2026-10-23', certainty: 'reported',
  outlet: 'Outlet A', url: `https://a.example/${n}`, published: '2026-10-20T00:00:00Z', seen: '2026-10-20',
  ...over,
});

test('cleanDate accepts day and month precision, rejects junk', () => {
  assert.equal(cleanDate('2026-10-23'), '2026-10-23');
  assert.equal(cleanDate('2026-11'), '2026-11');
  assert.equal(cleanDate('2026-02-30'), null);
  assert.equal(cleanDate('Oct 23'), null);
  assert.equal(cleanDate(null), null);
});

test('single outlet report is "reported"', () => {
  const s = resolveStream([claim()], TODAY);
  assert.equal(s.date, '2026-10-23');
  assert.equal(s.status, 'reported');
  assert.equal(s.available, false);
});

test('two outlets agreeing make it confirmed and, once past, available', () => {
  const s = resolveStream([claim(), claim({ outlet: 'Outlet B' })], TODAY);
  assert.equal(s.status, 'confirmed');
  assert.equal(s.available, true);
});

test('official announcement wins over more numerous older reports', () => {
  const s = resolveStream([
    claim({ date: '2026-11-07', outlet: 'A' }),
    claim({ date: '2026-11-07', outlet: 'B' }),
    claim({ date: '2026-11-14', outlet: 'C', certainty: 'official', published: '2026-10-22T00:00:00Z' }),
  ], TODAY);
  assert.equal(s.date, '2026-11-14');
  assert.equal(s.status, 'confirmed');
  assert.deepEqual(s.conflicts, ['2026-11-07']);
});

test('reports outside the recency window are ignored (postponement)', () => {
  const s = resolveStream([
    claim({ date: '2026-10-02', outlet: 'A', published: '2026-09-01T00:00:00Z' }),
    claim({ date: '2026-10-02', outlet: 'B', published: '2026-09-02T00:00:00Z' }),
    claim({ date: '2026-10-30', outlet: 'C', published: '2026-10-21T00:00:00Z' }),
  ], TODAY);
  assert.equal(s.date, '2026-10-30');
  assert.deepEqual(s.conflicts, []);
});

test('month report backs a matching day report', () => {
  const s = resolveStream([
    claim({ date: '2026-11', outlet: 'A', date_text: 'November' }),
    claim({ date: '2026-11-14', outlet: 'B' }),
  ], TODAY);
  assert.equal(s.date, '2026-11-14');
  assert.equal(s.precision, 'day');
  assert.equal(s.status, 'confirmed');
});

test('month-only date is never "confirmed" without an official source', () => {
  const s = resolveStream([claim({ date: '2026-12', outlet: 'A' }), claim({ date: '2026-12', outlet: 'B' })], TODAY);
  assert.equal(s.precision, 'month');
  assert.equal(s.status, 'reported');
});

test('all-speculative support is "rumored"', () => {
  const s = resolveStream([claim({ certainty: 'speculative', date: '2026-11-20' })], TODAY);
  assert.equal(s.status, 'rumored');
});

test('platform known but no date yields a TBA stream', () => {
  const s = resolveStream([claim({ date: null, certainty: 'official' })], TODAY);
  assert.equal(s.date, null);
  assert.equal(s.status, 'confirmed');
  assert.equal(s.available, false);
});

test('buildReleases groups by title, attaches platform-less dates to the only platform', () => {
  const releases = buildReleases([
    claim({ title: 'The Paradise', language: 'te', date: null, certainty: 'official' }),
    claim({ title: 'Paradise', language: 'te', platform: null, date: '2026-10-30', outlet: 'B' }),
  ], {}, TODAY);
  assert.equal(releases.length, 1);
  assert.equal(releases[0].streams.length, 1);
  assert.equal(releases[0].streams[0].platform, 'netflix');
  assert.equal(releases[0].streams[0].date, '2026-10-30');
});

test('buildReleases keeps separate platforms as separate streams', () => {
  const releases = buildReleases([
    claim({ platform: 'netflix' }),
    claim({ platform: 'prime-video', date: '2026-11-20', outlet: 'B' }),
  ], {}, TODAY);
  assert.equal(releases[0].streams.map((s) => s.platform).join(), 'netflix,prime-video');
});

test('TMDB match merges news claims with TMDB availability', () => {
  const details = {
    tmdb_id: 42, type: 'movie', title: 'Gajab Raat', original_title: 'Gajab Raat', language: 'hi', year: 2026,
    poster: '/p.jpg', overview: 'x', genres: ['Comedy'], cast: [], director: null, theatrical: '2026-09-12',
    digital: [{ date: '2026-10-23', note: 'Netflix' }], providers: ['Netflix'], fetched_at: '2026-10-24T00:00:00.000Z',
  };
  const news = claim();
  const releases = buildReleases(
    [news, ...tmdbClaims(details)],
    { matches: { 'gajab raat|hi|movie': { id: 42, type: 'movie' } }, details: { 'movie:42': details } },
    TODAY,
  );
  assert.equal(releases.length, 1);
  const r = releases[0];
  assert.equal(r.id, 'movie-42');
  assert.equal(r.poster, 'https://image.tmdb.org/t/p/w342/p.jpg');
  assert.equal(r.streams[0].status, 'confirmed');
  assert.equal(r.streams[0].available, true);
  assert.ok(!r.streams[0].sources.some((s) => s.outlet === 'JustWatch'));
});

test('IMDb rating is attached through the TMDB entry', () => {
  const details = {
    tmdb_id: 7, type: 'movie', imdb_id: 'tt123', title: 'Dorothy', language: 'ta', year: 2026,
    poster: null, overview: null, genres: [], cast: [], director: null, theatrical: null, digital: [], providers: [],
  };
  const [r] = buildReleases([claim({ title: 'Dorothy', language: 'ta' })],
    { matches: { 'dorothy|ta|movie': { id: 7, type: 'movie' } }, details: { 'movie:7': details }, ratings: { tt123: [7.4, 2310] } }, TODAY);
  assert.deepEqual(r.imdb, { id: 'tt123', rating: 7.4, votes: 2310 });
});

test('pickRatings reads only the wanted ids from the dataset lines', async () => {
  const { pickRatings } = await import('../scripts/lib/imdb.mjs');
  const lines = ['tconst\taverageRating\tnumVotes', 'tt001\t5.7\t2239', 'tt123\t7.4\t2310', 'tt999\t8.1\t10'];
  assert.deepEqual(await pickRatings(lines, new Set(['tt123', 'tt999'])), { tt123: [7.4, 2310], tt999: [8.1, 10] });
});

test('factToClaim normalizes platform, language and dates', () => {
  const c = factToClaim({
    title: ' Kantara ', type: 'movie', language: 'Kannada', year: 2025, platform: 'Amazon Prime Video',
    date: '2025-13-01', certainty: 'weird',
    article: { outlet: 'X', url: 'https://x', title: 'h', published: null },
  }, TODAY);
  assert.equal(c.title, 'Kantara');
  assert.equal(c.platform, 'prime-video');
  assert.equal(c.language, 'kn');
  assert.equal(c.date, null);
  assert.equal(c.certainty, 'reported');
  assert.equal(c.published, '2026-10-25T00:00:00.000Z');
});

test('a "now streaming" report without a date lands in out-now as available', () => {
  const c = factToClaim({
    title: 'Honey Bunch', type: 'movie', language: null, year: null, platform: 'JioHotstar', date: null,
    streaming_now: true, certainty: 'official',
    article: { outlet: 'X', url: 'https://x', title: 'h', published: '2026-10-24T00:00:00Z' },
  }, TODAY);
  assert.equal(c.available, true);
  const s = resolveStream([c], TODAY);
  assert.equal(s.available, true);
  assert.equal(s.status, 'confirmed');
});

test('unknown platforms are kept with their display name', () => {
  const c = factToClaim({
    title: 'Some Film', type: 'movie', language: 'kn', year: 2026, platform: 'Namma Flix', date: null, certainty: 'reported',
    article: { outlet: 'X', url: 'https://x', title: 'h', published: null },
  }, TODAY);
  assert.equal(c.platform, 'x-namma-flix');
  assert.equal(c.platform_name, 'Namma Flix');
});
