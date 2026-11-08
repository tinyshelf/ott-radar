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

function jsonLdBody(html) {
  for (const m of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const body = findArticleBody(JSON.parse(m[1].trim()));
      if (body) return htmlToText(body);
    } catch {
      // Malformed JSON-LD is common; try the next block.
    }
  }
  return null;
}

// Long <p> paragraphs, plus the headings and short bold lines between them.
// Round-ups name each title in one ("1. Dilwali Diwali", "<strong>6. Haiwaan –
// SonyLIV</strong>", "<strong>Where to watch:</strong> Netflix"). Headings after
// the last paragraph are page furniture ("Related Stories", "Follow Us").
function paragraphBlocks(html) {
  const blocks = [];
  for (const m of String(html).matchAll(/<(p|h[2-4])(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const text = htmlToText(m[2]);
    if (!text || /cookie|subscribe|newsletter|all rights reserved/i.test(text)) continue;
    if (m[1].toLowerCase() === 'p' && text.length > 60) blocks.push({ text, heading: false });
    else if (text.length <= 100 && (m[1].toLowerCase() !== 'p' || /^\s*<(strong|b)\b/i.test(m[2]))) blocks.push({ text, heading: true });
  }
  let last = blocks.length - 1;
  while (last >= 0 && blocks[last].heading) last--;
  return blocks.slice(0, last + 1);
}

// Quotes, dashes and spacing differ between articleBody and the page markup.
const squash = (s) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, '');

// articleBody keeps the text but not the headings that name each title in a
// round-up: it runs them into their neighbours ("this weekendHaiwaanAkshay Kumar")
// or leaves them out. Puts each heading back on a line of its own, where the page
// has it: in place, or else just before the paragraph that follows it. Paragraphs
// move the search forward, so a heading isn't matched in the text before it.
function addHeadings(body, blocks) {
  const pos = [];
  let flat = '';
  for (let i = 0; i < body.length; i++) {
    if (/\s/.test(body[i])) continue;
    flat += squash(body[i]);
    pos.push(i);
  }
  const breaks = new Map(); // body index -> text to put on its own line there
  const addBreak = (at, text = '') => breaks.set(at, (breaks.get(at) ?? '') + `\n${text}\n`);
  let from = 0;
  blocks.forEach((b, i) => {
    const key = squash(b.text);
    if (!b.heading) {
      const at = flat.indexOf(key.slice(0, 40), from);
      if (at !== -1) from = at + key.length;
      return;
    }
    if (key.length < 4) return;
    const at = flat.indexOf(key, from);
    if (at !== -1) {
      let end = pos[at + key.length - 1] + 1;
      while (/[.,;:!?]/.test(body[end] ?? '')) end++;
      addBreak(pos[at]);
      addBreak(end);
      from = at + key.length;
      return;
    }
    const next = blocks.slice(i + 1).find((x) => !x.heading);
    const nextAt = next ? flat.indexOf(squash(next.text).slice(0, 40), from) : -1;
    if (nextAt !== -1) addBreak(pos[nextAt], b.text);
  });
  let out = '';
  let last = 0;
  for (const at of [...breaks.keys()].sort((x, y) => x - y)) {
    out += body.slice(last, at) + breaks.get(at);
    last = at;
  }
  return (out + body.slice(last)).replace(/\s*\n\s*/g, '\n').trim();
}

// Best-effort article text: JSON-LD articleBody (most Indian news sites ship it)
// with the page's headings added back, falling back to <p> paragraphs.
export function extractArticleText(html) {
  const blocks = paragraphBlocks(html);
  const body = jsonLdBody(html);
  return body ? addHeadings(body, blocks) : blocks.map((b) => b.text).join('\n');
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
