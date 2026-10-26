import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformId } from '../scripts/lib/platforms.mjs';
import { parseRss } from '../scripts/lib/rss.mjs';
import { extractArticleText, normalizeTitle } from '../scripts/lib/text.mjs';
import { RELEVANT } from '../scripts/lib/sources.mjs';

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
