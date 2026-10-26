import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDictionary, extractFromArticle, findDates, findPlatforms, headlineTitle } from '../scripts/lib/rules.mjs';
import { parseWikiFilmList } from '../scripts/lib/dictionary.mjs';

const TODAY = '2026-10-25';
const dict = compileDictionary([
  { title: 'The Paradise', language: 'te', type: 'movie', year: 2026 },
  { title: 'Gajab Raat', language: 'hi', type: 'movie', year: 2026 },
  { title: 'Dorothy', language: 'ta', type: 'movie', year: 2026 },
  { title: 'Sumo Didi', language: 'hi', type: 'movie', year: 2026 },
  { title: 'Moana', language: 'en', type: 'movie', year: 2026 },
  { title: 'Dhoomakethu', language: 'ml', type: 'movie', year: 2026 },
  { title: 'Aaru Aanugal', language: 'ml', type: 'movie', year: 2026 },
  { title: 'Avarachan & Sons', language: 'ml', type: 'movie', year: 2026 },
  { title: 'Varam' },
  { title: 'Chaar Yaar' },
  { title: 'Love', language: 'hi', type: 'movie', year: 2026 },
]);
const article = (title, text, published = '2026-10-22T06:00:00Z') => ({ title, text, published, outlet: 'Test', url: 'https://t.example' });
const pick = (facts, title) => facts.filter((f) => f.title === title);

test('findDates handles common Indian news formats and resolves the year', () => {
  const d = (t) => findDates(t, '2026-10-22').map((x) => x.iso);
  assert.deepEqual(d('streaming from 23 October 2026'), ['2026-10-23']);
  assert.deepEqual(d('on Netflix on October 30'), ['2026-10-30']);
  assert.deepEqual(d('arrives on Oct. 30th'), ['2026-10-30']);
  assert.deepEqual(d('premieres on January 9'), ['2027-01-09']);
  assert.deepEqual(d('expected in November'), ['2026-11']);
  assert.deepEqual(d('lands this Friday'), ['2026-10-23']);
  assert.deepEqual(d('on Friday, October 23'), ['2026-10-23']);
  assert.deepEqual(d('releases this week (October 19–25, 2026)'), []);
  assert.deepEqual(d('24th Oct to 30th Oct'), []);
  assert.deepEqual(d('it may stream soon'), []);
});

test('findPlatforms matches glued text and skips ambiguous words', () => {
  const ids = (t) => findPlatforms(t).map((p) => p.id);
  assert.deepEqual(ids('Dorothy, NetflixKarthik Subbaraj'), ['netflix']);
  assert.deepEqual(ids('on Amazon Prime Video and Disney+ Hotstar'), ['prime-video', 'jiohotstar']);
  assert.deepEqual(ids('streams on aha from Friday'), ['aha']);
  assert.deepEqual(ids('prime time slot, trailer on YouTube'), []);
  assert.deepEqual(ids('Aha! What a twist'), []);
});

test('headlineTitle pulls single titles and rejects round-ups and announcements', () => {
  assert.equal(headlineTitle("‘Haiku’ OTT release date: Where to watch Aegan, Sridevi Apalla’s Tamil romance after theatrical run"), 'Haiku');
  assert.equal(headlineTitle("Jailer 2 OTT release: Rajinikanth's action thriller movie will stream on this platform"), 'Jailer 2');
  assert.equal(headlineTitle('Ramayana Movie OTT Release on JioHotstar Confirmed – Pay-Per-View Deal'), 'Ramayana');
  assert.equal(headlineTitle("Nani's The Paradise OTT release: 24 minutes cut"), 'The Paradise');
  assert.equal(headlineTitle("'The Odyssey' Digital Release: Christopher Nolan's epic hits home platforms Nov 17"), 'The Odyssey');
  assert.equal(headlineTitle('Vijay Sethupathi starrer ‘Baththa’ OTT release date out'), 'Baththa');
  assert.equal(headlineTitle('Mirzapur: The Movie OTT release: When and where to watch'), 'Mirzapur: The Movie');
  assert.equal(headlineTitle("It's a Medical Miracle OTT release on ManoramaMAX"), "It's a Medical Miracle");
  assert.equal(headlineTitle('Sikandar ka Mukaddar OTT release date'), 'Sikandar ka Mukaddar');
  assert.equal(headlineTitle('The Paradise becomes fastest ever OTT hit for Nani'), null);
  assert.equal(headlineTitle('Netflix Announces Anand Deverakonda’s Epic OTT Release Date'), null);
  assert.equal(headlineTitle('New OTT releases this week: Gajab Raat, Dorothy and more'), null);
  assert.equal(headlineTitle('7 South OTT Releases to Watch This Week: Nani starrer The Paradise'), null);
});

test('round-up with "Title (Platform, date)" entries', () => {
  const facts = extractFromArticle(article('New Hindi OTT releases this week (Oct 21-27)',
    'Gajab Raat (Netflix, Oct 23)Manoj Bajpayee headlines the thriller. .Sumo Didi (Zee 5, Oct 23)Directed by Jayant Rohatgi, a sports biopic.'), dict, TODAY);
  assert.deepEqual(pick(facts, 'Gajab Raat').map((f) => [f.platform, f.date]), [['netflix', '2026-10-23']]);
  assert.deepEqual(pick(facts, 'Sumo Didi').map((f) => [f.platform, f.date]), [['zee5', '2026-10-23']]);
});

test('round-up with "Where to watch / Streaming Date" blocks skips theatrical dates', () => {
  const facts = extractFromArticle(article('4 Telugu and Kannada OTT Releases to Watch This Week',
    '1. The Paradise\nCast: Nani\nGenre: Action Drama\nWhere to watch: Netflix\nStreaming Date: October 22, 2026\nIt released in theatres on September 24.\n2. Varam\nCast: Vishwadev Rachakonda\nGenre: Suspense Comedy Drama Series\nWhere to watch: JioHotstar\nStreaming Date: October 22, 2026\n'), dict, TODAY);
  assert.deepEqual(pick(facts, 'The Paradise').map((f) => [f.platform, f.date]), [['netflix', '2026-10-22']]);
  const varam = pick(facts, 'Varam');
  assert.deepEqual(varam.map((f) => [f.platform, f.date, f.type]), [['jiohotstar', '2026-10-22', 'series']]);
});

test('glued table rows and hedged dates', () => {
  const facts = extractFromArticle(article('This Week and Next Week OTT Releases',
    'Aaru AanugalManoramaMAXStreaming from 23 October 2026Siva Murali. DhoomakethuNetflixStreaming from 23 October 2026Sajin Gopu. Avarachan & SonsNetflixExpected 30 October 2026 – Not ConfirmedBiju Menon'), dict, TODAY);
  assert.deepEqual(pick(facts, 'Aaru Aanugal').map((f) => [f.platform, f.date]), [['manorama-max', '2026-10-23']]);
  assert.deepEqual(pick(facts, 'Dhoomakethu').map((f) => [f.platform, f.date]), [['netflix', '2026-10-23']]);
  const ava = pick(facts, 'Avarachan & Sons');
  assert.deepEqual(ava.map((f) => [f.platform, f.date, f.certainty]), [['netflix', '2026-10-30', 'speculative']]);
});

test('list items share the date that ends the list', () => {
  const facts = extractFromArticle(article('OTT releases this week',
    "The biggest arrival is Nani's The Paradise on Netflix on October 22, while Manoj Bajpayee's thriller Gajab Raat , Keerthy Suresh's Dorothy and the sports biopic Sumo Didi land on October 23. Disney's live-action Moana also arrives."), dict, TODAY);
  assert.deepEqual(pick(facts, 'The Paradise').map((f) => [f.platform, f.date]), [['netflix', '2026-10-22']]);
  for (const t of ['Gajab Raat', 'Dorothy', 'Sumo Didi']) {
    assert.deepEqual(pick(facts, t).map((f) => f.date), ['2026-10-23'], t);
  }
});

test('single-title article: platform from rights deal, theatrical date ignored', () => {
  const facts = extractFromArticle(article('Udta Teer OTT release and platform details: Where to watch Ayushmann Khurrana, Sara Ali Khan’s spy comedy',
    'Ayushmann Khurrana and Sara Ali Khan’s Udta Teer arrived in theatres on Friday, October 23. The spy comedy has seen limited buzz. Udta Teer OTT release details. Netflix has secured the digital rights of the film. The OTT release date is yet to be announced.', '2026-10-24T06:00:00Z'), dict, TODAY);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].title, 'Udta Teer');
  assert.equal(facts[0].platform, 'netflix');
  assert.equal(facts[0].date, null);
});

test('single-title article: announcement date is not the streaming date', () => {
  const facts = extractFromArticle(article('Ramayana Movie OTT Release on JioHotstar Confirmed – Pay-Per-View Deal',
    'Ramayana: Part One releases in cinemas on 5 November 2026, followed by a pay-per-view release on JioHotstar. The announcement, made in Mumbai on October 21, 2026, introduces a new digital access model. Its JioHotstar digital premiere date has not yet been announced.'), dict, TODAY);
  assert.equal(facts.length, 1);
  assert.equal(facts[0].platform, 'jiohotstar');
  assert.equal(facts[0].date, null);
  assert.equal(facts[0].certainty, 'official');
});

test('single-title article with no platform or date yields nothing', () => {
  const facts = extractFromArticle(article("‘Haiku’ OTT release date: Where to watch Aegan, Sridevi Apalla’s Tamil romance after theatrical run",
    'Tamil romantic drama Haiku arrived in theaters on October 23, 2026. An official OTT release date for Haiku is yet to be announced.'), dict, TODAY);
  assert.deepEqual(facts, []);
});

test('single-title article picks the confirmed streaming date', () => {
  const facts = extractFromArticle(article("'Immortal' OTT release date OUT: When and where to stream GV Prakash Kumar's horror romance",
    'The Tamil horror romance Immortal hit theatres on October 2. The makers have announced that Immortal will stream on Sun NXT from November 6.'), dict, TODAY);
  assert.equal(facts.length, 1);
  assert.deepEqual([facts[0].title, facts[0].platform, facts[0].date, facts[0].language, facts[0].certainty], ['Immortal', 'sun-nxt', '2026-11-06', 'ta', 'official']);
});

test('theatrical list items do not borrow the next streaming entry', () => {
  const d = compileDictionary([{ title: 'Udta Teer' }, { title: 'Little Thomas' }, { title: 'Gajab Raat' }]);
  const facts = extractFromArticle(article('Latest OTT And Theatrical Releases This Week',
    "Ayushmann Khurrana's Udta Teer and Little Thomas arrive in cinemas. International picks stream on Netflix. Gajab Raat Where to watch: Netflix Release date: October 23"), d, TODAY);
  assert.deepEqual(facts.map((f) => f.title), ['Gajab Raat']);
});

test('a sequel number makes it a different title', () => {
  const d = compileDictionary([{ title: 'Dhurandhar', language: 'hi', type: 'movie', year: 2025 }]);
  const facts = extractFromArticle(article('OTT releases this week', 'Fans praise its Dhurandhar 2-like climax, now on Prime Video from October 21.'), d, TODAY);
  assert.deepEqual(facts, []);
});

test('common-word titles are not matched in prose', () => {
  const facts = extractFromArticle(article('OTT releases this week', 'Love stories stream on Netflix from October 30.'), dict, TODAY);
  assert.deepEqual(facts, []);
});

test('parseWikiFilmList reads italic table cells and ignores citations', () => {
  const wikitext = [
    '{| class="wikitable"',
    "| ''[[Dhoomakethu (film)|Dhoomakethu]]'' || Sudhi Maddison || <ref>{{cite web |work=''[[The Hindu]]''}}</ref>",
    "| ''Aaru Aanugal'' || Sambraj Nair",
    "| ''[[Avarachan & Sons]]'' || Thamby",
    "Not a table line ''Ignored''",
    '|}',
  ].join('\n');
  assert.deepEqual(parseWikiFilmList(wikitext).sort(), ['Aaru Aanugal', 'Avarachan & Sons', 'Dhoomakethu']);
});
