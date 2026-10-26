import { createHash } from 'node:crypto';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' };

export function decodeEntities(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function stripCdata(s) {
  return String(s ?? '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
}

export function htmlToText(html) {
  return decodeEntities(
    String(html ?? '')
      .replace(/<(script|style|noscript|svg|iframe)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

function findArticleBody(node) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (typeof n.articleBody === 'string' && n.articleBody.length > 200) return n.articleBody;
    stack.push(...Object.values(n));
  }
  return null;
}

// Best-effort article text: JSON-LD articleBody (most Indian news sites ship it),
// falling back to long <p> paragraphs.
export function extractArticleText(html) {
  for (const m of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const body = findArticleBody(JSON.parse(m[1].trim()));
      if (body) return htmlToText(body);
    } catch {
      // Malformed JSON-LD is common; try the next block.
    }
  }
  const paras = [...String(html).matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/gi)]
    .map((m) => htmlToText(m[1]))
    .filter((t) => t.length > 60 && !/cookie|subscribe|newsletter|all rights reserved/i.test(t));
  return paras.join('\n');
}

// "The Paradise (Tamil)" -> "paradise"; used only for grouping keys.
export function normalizeTitle(title) {
  return decodeEntities(title)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\((19|20)\d\d\)/g, ' ')
    .replace(/['’‘`"“”]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9ऀ-෿]+/g, ' ')
    .replace(/^(the|a|an)\s+/, '')
    .trim();
}

export function slugify(s) {
  return normalizeTitle(s).replace(/\s+/g, '-').slice(0, 80) || 'untitled';
}

export function shortHash(...parts) {
  return createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12);
}
