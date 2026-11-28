import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReleases, cleanDate, factToClaim, isCurrent, movedIds, resolveStream, tmdbClaims } from '../scripts/lib/merge.mjs';

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

test('a future streaming date is not available, whatever JustWatch or a "now streaming" line says', () => {
  // JustWatch lists the platform early (older seasons, catalogue pre-listing);
  // the news date says the release is still to come.
  const justWatch = { ...claim({ date: null, certainty: 'official', outlet: 'JustWatch' }), available: true };
  const s = resolveStream([claim({ date: '2026-11-13' }), claim({ date: '2026-11-13', outlet: 'Outlet B' }), justWatch], TODAY);
  assert.equal(s.date, '2026-11-13');
  assert.equal(s.available, false);
  const month = resolveStream([claim({ date: '2026-12', certainty: 'official' }), justWatch], TODAY);
  assert.equal(month.available, false);
  const past = resolveStream([claim({ date: '2026-10-23' }), justWatch], TODAY);
  assert.equal(past.available, true);
});

test('isCurrent keeps upcoming and recent releases, drops old OTT dates and catalogue-only listings', () => {
  const stream = (over) => ({ platform: 'netflix', date: null, precision: null, available: false, first_seen: '2026-10-20', sources: [{ outlet: 'A' }], ...over });
  const rel = (...streams) => ({ title: 'X', streams });
  // Today is 2026-10-25, so the 90-day window starts on 2026-07-27.
  assert.equal(isCurrent(rel(stream({ date: '2026-11-20', precision: 'day' })), TODAY), true);
  assert.equal(isCurrent(rel(stream({ date: '2026-08-14', precision: 'day', available: true })), TODAY), true);
  assert.equal(isCurrent(rel(stream({ date: '2025-10-17', precision: 'day', available: true })), TODAY), false);
  assert.equal(isCurrent(rel(stream({ date: '2026-07', precision: 'month' })), TODAY), true);
  // Old Netflix date plus a JustWatch-only listing on a second platform: still old.
  assert.equal(isCurrent(rel(
    stream({ date: '2026-01-30', precision: 'day', available: true }),
    stream({ platform: 'jiohotstar', available: true, first_seen: '2026-10-24', sources: [] }),
  ), TODAY), false);
  // Undated news report counts by when it was first seen.
  assert.equal(isCurrent(rel(stream({ available: true, first_seen: '2026-10-23' })), TODAY), true);
  assert.equal(isCurrent(rel(stream({ available: true, first_seen: '2026-06-01' })), TODAY), false);
  // JustWatch alone: a recent film with no OTT date yet counts, back catalogue doesn't.
  const justWatch = stream({ available: true, first_seen: '2026-10-24', sources: [] });
  assert.equal(isCurrent({ ...rel(justWatch), year: 2026 }, TODAY), true);
  assert.equal(isCurrent({ ...rel(justWatch), year: 2019 }, TODAY), false);
});

test('unknown platforms are kept with their display name', () => {
  const c = factToClaim({
    title: 'Some Film', type: 'movie', language: 'kn', year: 2026, platform: 'Namma Flix', date: null, certainty: 'reported',
    article: { outlet: 'X', url: 'https://x', title: 'h', published: null },
  }, TODAY);
  assert.equal(c.platform, 'x-namma-flix');
  assert.equal(c.platform_name, 'Namma Flix');
});

test('on equal backing the newer report wins over a more precise older one', () => {
  // An old round-up's cinema date against a newer "streams in March" story.
  const s = resolveStream([
    claim({ date: '2026-11-20', outlet: 'A', published: '2026-11-17T00:00:00Z' }),
    claim({ date: '2027-03', outlet: 'B', published: '2026-11-23T00:00:00Z' }),
  ], TODAY);
  assert.equal(s.date, '2027-03');
  // A day still beats the month it falls in.
  const same = resolveStream([
    claim({ date: '2026-11', outlet: 'A', published: '2026-10-22T00:00:00Z' }),
    claim({ date: '2026-11-14', outlet: 'A', published: '2026-10-20T00:00:00Z' }),
  ], TODAY);
  assert.equal(same.date, '2026-11-14');
});

// A Telugu film in cinemas from 16 October: streaming within two weeks of that is
// the cinema date misread.
const film = (over) => ({
  tmdb_id: 9, type: 'movie', title: 'Bhogi', original_title: 'Bhogi', language: 'te', year: 2026,
  poster: null, overview: null, genres: [], cast: [], director: null,
  theatrical: '2026-10-16', cinema: '2026-10-16', digital: [], providers: [], fetched_at: '2026-10-24T00:00:00.000Z',
  ...over,
});
const bhogi = (over) => claim({ title: 'Bhogi', language: 'te', platform: 'prime-video', date: '2026-10-16', ...over });
function build(claims, details, opts = {}) {
  return buildReleases([...claims, ...tmdbClaims(details)],
    { matches: { 'bhogi|te|movie': { id: 9, type: 'movie' } }, details: { 'movie:9': details }, ...opts }, TODAY);
}

test('a streaming date within two weeks of the cinema release is ignored', () => {
  const audit = { implausible: [], unverified: [] };
  const [r] = build([bhogi()], film(), { audit });
  assert.equal(r.streams[0].platform, 'prime-video');
  assert.equal(r.streams[0].date, null);
  assert.equal(r.streams[0].available, false);
  assert.deepEqual(audit.implausible.map((x) => [x.title, x.date, x.cinema]), [['Bhogi', '2026-10-16', '2026-10-16']]);
  // Months before the cinema release ("Fauzi on Netflix" for a March 2027 film).
  assert.equal(build([bhogi({ date: '2026-10-02' })], film({ cinema: '2027-03-19' }))[0].streams[0].date, null);
  // A month that ends before the earliest plausible day.
  assert.equal(build([bhogi({ date: '2026-10' })], film({ cinema: '2026-10-20' }))[0].streams[0].date, null);
  // A "now streaming" report days after the cinema release.
  const now = { ...bhogi({ date: null, certainty: 'official', published: '2026-10-18T00:00:00Z' }), available: true };
  assert.equal(build([now], film())[0].streams[0].available, false);
});

test('an early streaming date stands when JustWatch, TMDB or three outlets back it', () => {
  assert.equal(build([bhogi()], film({ providers: ['Amazon Prime Video'] }))[0].streams[0].date, '2026-10-16');
  assert.equal(build([bhogi()], film({ digital: [{ date: '2026-10-16', note: null }] }))[0].streams[0].date, '2026-10-16');
  const three = [bhogi({ outlet: 'A' }), bhogi({ outlet: 'B' }), bhogi({ outlet: 'C' })];
  assert.equal(build(three, film())[0].streams[0].date, '2026-10-16');
  // Four weeks after the cinema release is normal.
  assert.equal(build([bhogi({ date: '2026-11-13' })], film())[0].streams[0].date, '2026-11-13');
});

test('direct-to-OTT films have no cinema date, so their streaming date stands', () => {
  // TMDB's fallback "theatrical" date is the streaming date; it isn't shown either.
  const [r] = build([bhogi()], film({ cinema: null }));
  assert.equal(r.streams[0].date, '2026-10-16');
  assert.equal(r.theatrical, null);
  // Entries cached before cinema dates were collected fall back to the old date.
  const { cinema, ...legacy } = film();
  assert.equal(build([bhogi()], legacy)[0].streams[0].date, null);
});

test('a cinema date reported without a platform leaves nothing to list', () => {
  assert.equal(build([bhogi({ platform: null })], film()).length, 0);
});

test('a title gets one match whatever language or type each article guessed', () => {
  const show = { ...film({ tmdb_id: 5, type: 'series', title: 'Rudravanam PS', cinema: null }) };
  const releases = buildReleases([
    claim({ title: 'Rudravanam PS', language: 'te', type: 'series', platform: 'zee5' }),
    claim({ title: 'Rudravanam PS', language: null, type: 'movie', platform: 'zee5', outlet: 'B' }),
    claim({ title: 'Rudravanam PS', language: 'ko', type: 'movie', platform: 'zee5', outlet: 'C' }),
  ], {
    matches: { 'rudravanam ps|te|series': { id: 5, type: 'series' }, 'rudravanam ps||movie': { id: null }, 'rudravanam ps|ko|movie': { id: null } },
    details: { 'series:5': show },
  }, TODAY);
  assert.deepEqual(releases.map((r) => [r.id, r.type, r.streams[0].outlets]), [['series-5', 'series', 3]]);
});

test('a shared match never joins an English title to an Indian one, or picks between namesakes', () => {
  const english = film({ tmdb_id: 7, title: 'Law and Order', language: 'en', cinema: null });
  const ml = claim({ title: 'Law and Order', language: 'ml', platform: 'manorama-max' });
  const split = buildReleases([claim({ title: 'Law and Order', language: 'en' }), ml],
    { matches: { 'law and order|en|movie': { id: 7, type: 'movie' } }, details: { 'movie:7': english } }, TODAY);
  assert.equal(split.length, 2);
  const two = buildReleases([claim({ title: 'Happy Journey', language: null, outlet: 'Z' })], {
    matches: { 'happy journey|en|movie': { id: 1, type: 'movie' }, 'happy journey|te|movie': { id: 2, type: 'movie' } },
    details: { 'movie:1': film({ tmdb_id: 1, language: 'en' }), 'movie:2': film({ tmdb_id: 2, language: 'te' }) },
  }, TODAY);
  assert.ok(two[0].id.startsWith('happy-journey-'));
});

test('with a known-title list, an unmatched title needs to be on it or have two outlets', () => {
  const audit = { implausible: [], unverified: [] };
  const lone = claim({ title: 'Megaverse', outlet: 'A' });
  assert.equal(buildReleases([lone], { known: new Set(), audit }, TODAY).length, 0);
  assert.deepEqual(audit.unverified.map((r) => r.title), ['Megaverse']);
  assert.equal(buildReleases([lone], { known: new Set(['megaverse']) }, TODAY).length, 1);
  assert.equal(buildReleases([lone, claim({ title: 'Megaverse', outlet: 'B' })], { known: new Set() }, TODAY).length, 1);
  // A new season counts when the show is known.
  const season = claim({ title: 'Aashram 4', type: 'series', platform: 'amazon-mx-player' });
  assert.equal(buildReleases([season], { known: new Set(['aashram']) }, TODAY).length, 1);
  // Without a list nothing is filtered.
  assert.equal(buildReleases([lone], {}, TODAY).length, 1);
});

test('movedIds points ids that disappeared at the release now holding the title', () => {
  const previous = {
    releases: [
      { id: 'rudravanam-ps-0180d0', title: 'Rudravanam PS', type: 'movie' },
      { id: 'dalimb-1a2b3c', title: 'Dalimb 2026 | Dalimb Hindi Movie', type: 'movie' },
      { id: 'megaverse-moves-closer-1', title: 'Megaverse Moves Closer', type: 'movie' },
      { id: 'movie-9', title: 'Dalimb', type: 'movie' },
    ],
    moved: { 'rudravanam-ps-a83572': 'rudravanam-ps-0180d0', 'old-gone': 'nowhere' },
  };
  const releases = [{ id: 'series-5', title: 'Rudravanam PS', type: 'series' }, { id: 'movie-9', title: 'Dalimb', type: 'movie' }];
  assert.deepEqual(movedIds(previous, releases), {
    'rudravanam-ps-0180d0': 'series-5',
    'rudravanam-ps-a83572': 'series-5',
    'dalimb-1a2b3c': 'movie-9',
  });
});
