import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileDictionary, extractFromArticle, findDates, findPlatforms, headlineTitle, tidyTitle } from '../scripts/lib/rules.mjs';
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

test('tidyTitle strips headline status words and rejects fragments', () => {
  const cases = {
    'Baththa Now Streaming': 'Baththa',
    'Mirzapur The Movie arrives': 'Mirzapur The Movie',
    'Udta Teer Movie :': 'Udta Teer',
    'Obsession Hindi Dub': 'Obsession',
    'Obsession Hindi Version': 'Obsession',
    'Sigma: Reported': 'Sigma',
    'Baththa: Potential': 'Baththa',
    'Don’t Trouble the Trouble: Can': 'Don’t Trouble the Trouble',
    'Baththa: Missed in Theatres, Masterpiece': 'Baththa',
    'Baththa on Netflix: Vijay Sethupathi': 'Baththa',
    'Dorothy, starring Keerthy Suresh,': 'Dorothy',
    'OTT Alert: Anakapalli': 'Anakapalli',
    'The Vvan Hits': 'The Vvan',
    // Real titles stay as they are.
    'Mirzapur: The Movie': 'Mirzapur: The Movie',
    'Ramayana: Part 1': 'Ramayana: Part 1',
    'Dhurandhar 2': 'Dhurandhar 2',
    'One Year to Live, Buy a Man': 'One Year to Live, Buy a Man',
    'Saas Bahu Achaar Pvt. Ltd.': 'Saas Bahu Achaar Pvt. Ltd.',
    'Animal': 'Animal',
    '418 Movie Watch Online:': '418',
    'The Super Mario Galaxy Movie': 'The Super Mario Galaxy Movie',
    'The Big Short': 'The Big Short',
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(tidyTitle(raw), want, raw);
  for (const junk of ['850 Crore Blockbuster', 'Rs 800 Crore Hit, Yet', 'From Theatres', 'Netflix October 30', 'Akka to Obsession: 7', '8 South', 'Friday', 'Halloween']) {
    assert.equal(tidyTitle(junk), null, junk);
  }
});

test('headlineTitle treats day and festival listicles as round-ups and tidies the title', () => {
  assert.equal(headlineTitle('Friday OTT Releases (October 30): Watch Obsession, A Couple Of Lies And More Online'), null);
  assert.equal(headlineTitle('Halloween OTT watchlist: From ‘Obsession’ to ‘Train to Busan’, 6 horror films to binge'), null);
  assert.equal(headlineTitle("8 South OTT And Theatrical Releases To Watch In Diwali Weekend: I'm Game, Meesaya Murukku 2"), null);
  assert.equal(headlineTitle('From Theatres to OTT: Can Jailer 2 Repeat the Madness?'), null);
  assert.equal(headlineTitle('Rs 800 Crore Hit, Yet OTT So Soon?'), null);
  assert.equal(headlineTitle('Baththa Now Streaming On OTT: Where To Watch Vijay Sethupathi And Lijomol Jose Film Online'), 'Baththa');
  assert.equal(headlineTitle("Sundeep Kishan’s Sigma: Reported OTT Release Date And Streaming Details"), 'Sigma');
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

test('round-up with a heading per title, a blurb, then release fields', () => {
  const d = compileDictionary([
    { title: 'Dilwali Diwali', language: 'hi', type: 'movie' },
    { title: 'Haiwaan', language: 'hi', type: 'movie' },
    { title: 'Yaga', language: 'en', type: 'series' },
  ]);
  const facts = extractFromArticle(article('New OTT Releases This Diwali Weekend (Nov 6-8, 2026)', [
    'Here are 11 movies and shows releasing on OTT platforms between November 5 and 8, 2026.',
    '1. Dilwali Diwali',
    'Diwali reunions rarely go to plan, and Dilwali Diwali builds its family drama around coming home. Directed by Ritesh Menon, it follows a young man caught in family expectations.',
    'Release date: November 5, 2026',
    'Where to watch: Netflix',
    '2. Campus Drivers',
    'A French romance set at a university, it was a hit in theatres on October 2.',
    'Release date: November 6, 2026',
    'Where to watch: Prime Video',
    '3. Haiwaan',
    'Akshay Kumar and Saif Ali Khan reunite in Haiwaan, a Hindi crime thriller directed by Priyadarshan.',
    'Release Date: November 6, 2026 Platform: SonyLIV',
    '4. Yaga',
    'Hudson Williams stars in this folklore horror series.',
  ].join('\n'), '2026-11-05T06:00:00Z'), d, '2026-11-05');
  assert.deepEqual(pick(facts, 'Dilwali Diwali').map((f) => [f.platform, f.date]), [['netflix', '2026-11-05']]);
  assert.deepEqual(pick(facts, 'Haiwaan').map((f) => [f.platform, f.date]), [['sonyliv', '2026-11-06']]);
  // Campus Drivers is not a known title, so its block must not leak into its neighbours.
  assert.deepEqual(pick(facts, 'Yaga'), []);
  assert.equal(facts.length, 2);
});

test('round-up with "Title – Platform" headings and the date in the blurb', () => {
  const d = compileDictionary([{ title: 'Haiwaan', language: 'hi' }, { title: 'Campus Drivers', language: 'fr' }]);
  const facts = extractFromArticle(article('What to watch on OTT this long weekend: 11 new movies and shows', [
    'Haiwaan – SonyLIV',
    'Starring Akshay Kumar and Saif Ali Khan, Haiwaan is a Hindi crime thriller directed by Priyadarshan. The film will begin streaming on SonyLIV on November 6, 2026.',
    'Campus Drivers – Amazon Prime Video',
    'Based on a bestselling novel, Campus Drivers is a romantic drama set around university life. The series will be available from November 6.',
  ].join('\n'), '2026-11-04T06:00:00Z'), d, '2026-11-04');
  assert.deepEqual(pick(facts, 'Haiwaan').map((f) => [f.platform, f.date]), [['sonyliv', '2026-11-06']]);
  assert.deepEqual(pick(facts, 'Campus Drivers').map((f) => [f.platform, f.date]), [['prime-video', '2026-11-06']]);
});

test('heading with a subtitle the dictionary lacks, and "OTT Release :" lines', () => {
  const d = compileDictionary([{ title: 'The Vvaan', language: 'hi' }, { title: 'Ramba Oorvasi Menaka', language: 'te' }]);
  const facts = extractFromArticle(article('New Telugu and Hindi OTT Releases This Week', [
    'The Vvaan: Force of the Forest',
    'Sidharth Malhotra stars in a fantasy thriller rooted in folklore and set in a forbidden forest.',
    'OTT Release : November 6, 2026 – Prime Video',
    'Ramba Oorvasi Menaka',
    'Allari Naresh plays a young man whose childhood wish comes true when three celestial nymphs descend to earth.',
    'OTT Release : Amazon Prime Video - September 25',
    'Verdict : A breezy entertainer for uncomplicated fun.',
  ].join('\n'), '2026-11-05T06:00:00Z'), d, '2026-11-05');
  assert.deepEqual(facts.map((f) => [f.title, f.platform, f.date]), [
    ['The Vvaan', 'prime-video', '2026-11-06'],
    ['Ramba Oorvasi Menaka', 'prime-video', '2026-09-25'],
  ]);
});

test('links to other stories are not headings, and list items do not borrow from the next line', () => {
  const d = compileDictionary([
    { title: 'The Paradise' }, { title: 'Dorothy' }, { title: 'Sumo Didi' }, { title: 'I Play Rocky' }, { title: "I'm Game" },
  ]);
  const facts = extractFromArticle(article('Best OTT Releases This Week', [
    'Paradise to Dorothy, Sumo Didi: Best OTT Releases This Week',
    'SonyLIV is streaming Haiwaan this weekend, featuring Saif Ali Khan and Akshay Kumar.',
    'Theatrical releases to book tickets for: Ramayana, I Play Rocky, Godzilla Minus Zero And More.',
    "5. I'm Game",
    'Release date: November 6, 2026',
    'Where to watch: JioHotstar',
  ].join('\n'), '2026-11-05T06:00:00Z'), d, '2026-11-05');
  assert.deepEqual(facts.map((f) => [f.title, f.platform, f.date]), [["I'm Game", 'jiohotstar', '2026-11-06']]);
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

test('single-title article about a sequel ignores lines about the first film', () => {
  const facts = extractFromArticle(article('Mookuthi Amman 2 OTT Release Date – JioHotstar Secures Rights',
    "JioHotstar has acquired the digital rights of Nayanthara's Mookuthi Amman 2 after its theatrical run.\nMookuthi Amman Streaming Now on JioHotstar – Watch the First Film"), dict, TODAY);
  assert.equal(facts.length, 1);
  assert.deepEqual([facts[0].title, facts[0].platform, facts[0].streaming_now], ['Mookuthi Amman 2', 'jiohotstar', false]);
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
