import { decodeEntities, htmlToText, stripCdata } from './text.mjs';

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? stripCdata(m[1]).trim() : '';
}

// Minimal RSS 2.0 parser — enough for WordPress, news-site and Google News feeds.
export function parseRss(xml) {
  const items = [];
  for (const m of String(xml).matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const sourceMatch = block.match(/<source(?:\s+url="([^"]*)")?[^>]*>([\s\S]*?)<\/source>/i);
    const published = tag(block, 'pubDate') || tag(block, 'dc:date');
    const date = published ? new Date(published) : null;
    items.push({
      title: htmlToText(decodeEntities(tag(block, 'title'))),
      link: decodeEntities(tag(block, 'link')).trim(),
      published: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
      description: htmlToText(decodeEntities(tag(block, 'description'))),
      content: htmlToText(decodeEntities(tag(block, 'content:encoded'))),
      source: sourceMatch ? { url: sourceMatch[1] ?? null, name: htmlToText(sourceMatch[2]) } : null,
    });
  }
  return items;
}
