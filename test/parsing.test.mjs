import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformId } from '../scripts/lib/platforms.mjs';
import { parseRss } from '../scripts/lib/rss.mjs';
import { extractArticleText, normalizeTitle } from '../scripts/lib/text.mjs';
import { RELEVANT } from '../scripts/lib/sources.mjs';
import { searchTitle } from '../scripts/lib/tmdb.mjs';
import { selectHeadlines } from '../scripts/lib/collect.mjs';

test('platformId maps aliases and TMDB provider names', () => {
  assert.equal(platformId('Amazon Prime Video'), 'prime-video');
  assert.equal(platformId('Amazon Prime Video with Ads'), 'prime-video');
  assert.equal(platformId('Disney+ Hotstar'), 'jiohotstar');
  assert.equal(platformId('JioCinema'), 'jiohotstar');
  assert.equal(platformId('Netflix basic with Ads'), 'netflix');
  assert.equal(platformId('Sony LIV'), 'sonyliv');
  assert.equal(platformId('aha'), 'aha');
  assert.equal(platformId('Lionsgate Play Amazon Channel'), 'lionsgate-play');
  assert.equal(platformId('Netflix India'), 'netflix');
  assert.equal(platformId(''), null);
  assert.equal(platformId('Some Unknown Service'), null);
});

test('parseRss reads Google News items with source', () => {
  const xml = `<rss><channel><item><title>&#8216;Haiku&#8217; OTT release date - The Times of India</title>
    <link>https://news.google.com/rss/articles/ABC?oc=5</link>
    <pubDate>Thu, 22 Oct 2026 07:00:00 GMT</pubDate>
    <description>&lt;a href="x"&gt;Haiku&lt;/a&gt;</description>
    <source url="https://timesofindia.indiatimes.com">The Times of India</source></item></channel></rss>`;
  const [item] = parseRss(xml);
  assert.equal(item.title, '‘Haiku’ OTT release date - The Times of India');
  assert.equal(item.link, 'https://news.google.com/rss/articles/ABC?oc=5');
  assert.equal(item.published, '2026-10-22T07:00:00.000Z');
  assert.equal(item.source.name, 'The Times of India');
  assert.equal(item.description, 'Haiku');
});

test('parseRss reads WordPress CDATA content', () => {
  const xml = `<rss><item><title><![CDATA[Film X streaming on aha from Friday]]></title><link>https://a.example/x</link>
    <content:encoded><![CDATA[<p>Film X will stream on <b>aha</b> from October 30.</p>]]></content:encoded></item></rss>`;
  const [item] = parseRss(xml);
  assert.equal(item.title, 'Film X streaming on aha from Friday');
  assert.equal(item.content, 'Film X will stream on aha from October 30.');
});

test('extractArticleText prefers JSON-LD articleBody', () => {
  const body = 'Udta Teer arrived in theatres on Friday. Netflix has secured the digital rights of the film. '.repeat(3);
  const html = `<html><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","articleBody":${JSON.stringify(body)}}]}</script><p>We use cookies to improve your experience on this website and more text here.</p></html>`;
  assert.equal(extractArticleText(html), body.trim());
});

test('extractArticleText paragraph fallback ignores <path> and other p-prefixed tags', () => {
  const html = '<svg><path d="M0 0">.x{background:url(data:image/svg+xml)}</path></svg><p class="a">Dhoomakethu begins streaming on Netflix from October 23, 2026, after its theatrical run.</p>';
  assert.equal(extractArticleText(html), 'Dhoomakethu begins streaming on Netflix from October 23, 2026, after its theatrical run.');
});

test('extractArticleText keeps round-up headings that JSON-LD articleBody leaves out', () => {
  const blurb = 'Diwali reunions rarely go to plan, and this family drama builds its story around coming home for the festival.';
  const thriller = 'Akshay Kumar and Saif Ali Khan reunite in a Hindi crime thriller directed by Priyadarshan.';
  const body = `This Diwali weekend brings eleven new OTT releases across languages and genres. ${blurb} Release date: November 5, 2026Where to watch: Netflix.${thriller} Read more.`;
  const html = `<script type="application/ld+json">{"@type":"NewsArticle","articleBody":${JSON.stringify(body)}}</script>
    <p>This Diwali weekend brings eleven new OTT releases across languages and genres.</p>
    <h2>1. Dilwali Diwali</h2><p>${blurb}</p>
    <p><strong>Release date:</strong> November 5, 2026</p><p><strong>Where to watch:</strong> Netflix</p>
    <h2>2. Haiwaan – SonyLIV</h2><p>${thriller}</p>
    <h2>Related Stories</h2>`;
  assert.equal(extractArticleText(html), [
    'This Diwali weekend brings eleven new OTT releases across languages and genres.',
    '1. Dilwali Diwali', blurb, 'Release date: November 5, 2026', 'Where to watch: Netflix.',
    '2. Haiwaan – SonyLIV', `${thriller} Read more.`,
  ].join('\n'));
});

test('extractArticleText paragraph fallback keeps short bold list items', () => {
  const html = '<p>There are a total of 16 movies or shows released this weekend on six streaming platforms.</p><p><strong>6. Haiwaan – SonyLIV</strong></p><p>Akshay Kumar and Saif Ali Khan star in this crime thriller about a visually impaired man.</p><p><b>Follow Us</b></p>';
  assert.equal(extractArticleText(html), 'There are a total of 16 movies or shows released this weekend on six streaming platforms.\n6. Haiwaan – SonyLIV\nAkshay Kumar and Saif Ali Khan star in this crime thriller about a visually impaired man.');
});

test('normalizeTitle collapses punctuation, articles and quotes', () => {
  assert.equal(normalizeTitle("'The Paradise'"), 'paradise');
  assert.equal(normalizeTitle('Kantara: Chapter 1'), 'kantara chapter 1');
  assert.equal(normalizeTitle('Jailer 2 (2026)'), 'jailer 2');
});

test('RELEVANT keeps OTT headlines and drops unrelated ones', () => {
  assert.ok(RELEVANT.test('Immortal OTT release date confirmed'));
  assert.ok(RELEVANT.test('Dorothy to premiere on ZEE5 this Friday'));
  assert.ok(!RELEVANT.test('Udta Teer box office collection day 2'));
});

test('TMDB search drops the season from series titles', () => {
  assert.equal(searchTitle({ title: 'Wednesday Season 3', type: 'series' }), 'Wednesday');
  assert.equal(searchTitle({ title: 'The Terminal List season 2', type: 'series' }), 'The Terminal List');
  assert.equal(searchTitle({ title: 'Dhindora S2', type: 'series' }), 'Dhindora');
  assert.equal(searchTitle({ title: 'Season 2', type: 'series' }), 'Season 2');
  assert.equal(searchTitle({ title: 'Jailer 2', type: 'movie' }), 'Jailer 2');
});

test('backfills spread the article budget over every week, round-ups first', () => {
  const h = (id, day, roundup = false) => ({ id, published: `2026-${day}T10:00:00Z`, roundup });
  // Newest first, as collectHeadlines returns them: three recent stories, one each from older weeks.
  const heads = [h('n1', '11-07'), h('n2', '11-06'), h('r1', '11-05', true), h('n3', '11-05'), h('s1', '10-15'), h('r2', '09-10', true), h('a1', '08-20')];
  assert.deepEqual(selectHeadlines(heads, 4).map((x) => x.id), ['r1', 'r2', 'n1', 'n2']);
  assert.deepEqual(selectHeadlines(heads, 4, { spread: true }).map((x) => x.id), ['r1', 'r2', 'n1', 's1']);
});
