// Rule-based extraction of OTT release facts from news articles.
//
// Two modes:
//  - single-title articles ("Jailer 2 OTT release date: ...") take the title from
//    the headline and pool platform/date evidence from every streaming sentence;
//  - everything else (round-ups) finds known titles in the text and reads the
//    platform and date that follow each mention, up to the next title.
// Dates count only when the nearest cue word is about streaming, not theatres,
// announcements or trailers.
import { PLATFORMS } from './platforms.mjs';
import { normalizeTitle } from './text.mjs';
import { ROUNDUP } from './sources.mjs';

const DAY_MS = 86400e3;
const SCOPE_CHARS = 350;

// ---------- platforms in free text ----------

// Aliases too ambiguous to match in prose ("prime time", "trailer on YouTube").
const PROSE_SKIP = new Set(['prime', 'stage', 'stage app', 'waves', 'youtube', 'youtube movies', 'youtube movies & tv', 'amazon video', 'sony live']);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const platformAliases = [];
for (const [id, p] of Object.entries(PLATFORMS)) {
  for (const a of new Set([p.name.toLowerCase(), ...p.aliases])) {
    if (!PROSE_SKIP.has(a)) platformAliases.push([a, id]);
  }
}
platformAliases.sort((a, b) => b[0].length - a[0].length);
const PLATFORM_RE = new RegExp(platformAliases.map(([a]) => escapeRe(a).replace(/\s+/g, '\\s*')).join('|'), 'gi');
const ALIAS_TO_ID = new Map(platformAliases.map(([a, id]) => [a.replace(/\s+/g, ''), id]));

const isWordChar = (ch) => !!ch && /[\p{L}\p{N}]/u.test(ch);
const isLowerOrDigit = (ch) => !!ch && /[\p{Ll}\p{N}]/u.test(ch);
// Scraped tables often lose their separators ("Aaru AanugalManoramaMAXStreaming"),
// so a lowercase->uppercase join counts as a boundary on the left, and the right
// edge only has to avoid running into a lowercase letter or digit.
const badEdges = (text, start, end) =>
  (isWordChar(text[start - 1]) && !(/\p{Ll}/u.test(text[start - 1]) && /\p{Lu}/u.test(text[start])))
  || isLowerOrDigit(text[end]);

export function findPlatforms(text) {
  const out = [];
  for (const m of text.matchAll(PLATFORM_RE)) {
    const start = m.index;
    const end = start + m[0].length;
    if (badEdges(text, start, end)) continue;
    if (/^aha$/i.test(m[0]) && (text[end] === '!' || m[0] === 'AHA')) continue;
    const id = ALIAS_TO_ID.get(m[0].toLowerCase().replace(/\s+/g, ''));
    if (id) out.push({ start, end, id });
  }
  return out;
}

// ---------- dates ----------

const MONTH_INDEX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = '(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const DAY = '(\\d{1,2})(?:st|nd|rd|th)?';
const YEAR = '(?:,?\\s*(\\d{4}))?';
const DMY = new RegExp(`(?<!\\d)${DAY}\\s+(?:of\\s+)?${MON}${YEAR}(?!\\d)`, 'g');
const MDY = new RegExp(`\\b${MON}\\s+${DAY}${YEAR}(?!\\d)`, 'g');
const MONTH_YEAR = new RegExp(`\\b${MON}\\s+(\\d{4})\\b`, 'g');
const MONTH_ONLY = new RegExp(`\\b(?:in|by|from|during|for|this|next|early|mid|late|end\\s+of|later\\s+in)\\s+(?:(?:early|mid|late)[\\s-]+)?${MON}(?!\\s*\\d)`, 'g');
const RELATIVE = /\b(today|tomorrow|tonight)\b/gi;
const WEEKDAY = /\b(this|on|coming|from|next)\s+(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}${d ? '-' + String(d).padStart(2, '0') : ''}`;
const isoToMs = (s) => Date.parse(`${s.length === 7 ? s + '-01' : s}T00:00:00Z`);
const msToIso = (ms) => new Date(ms).toISOString().slice(0, 10);

function validDay(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// A date without a year is assumed to fall within ~4 months before / 8 after the article.
function withYear(month, day, ref) {
  const refMs = isoToMs(ref);
  let y = Number(ref.slice(0, 4));
  const ms = Date.UTC(y, month - 1, day || 1);
  if (ms < refMs - 120 * DAY_MS) y += 1;
  else if (ms > refMs + 240 * DAY_MS) y -= 1;
  return y;
}

function isRange(text, start, end) {
  const after = text.slice(end, end + 8);
  const before = text.slice(Math.max(0, start - 16), start);
  return /^\s*(?:[-–—]|to\b|till\b|until\b)\s*(?:\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/.test(text.slice(end, end + 14))
    || /\d\s*(?:st|nd|rd|th)?\s*(?:\p{L}+\.?\s*)?(?:[-–—]|\bto|\btill|\buntil)\s*$/u.test(before);
}

// Returns [{ start, end, iso, precision }] for absolute and relative dates in text.
// `ref` is the article's publish date (YYYY-MM-DD, IST).
export function findDates(text, ref) {
  const found = [];
  const add = (start, end, value, precision) => found.push({ start, end, iso: value, precision });
  const month = (name) => MONTH_INDEX[name.slice(0, 3).toLowerCase()];

  for (const m of text.matchAll(DMY)) {
    const d = Number(m[1]); const mo = month(m[2]);
    const y = m[3] ? Number(m[3]) : withYear(mo, d, ref);
    if (validDay(y, mo, d) && !isRange(text, m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, iso(y, mo, d), 'day');
  }
  for (const m of text.matchAll(MDY)) {
    const mo = month(m[1]); const d = Number(m[2]);
    const y = m[3] ? Number(m[3]) : withYear(mo, d, ref);
    if (validDay(y, mo, d) && !isRange(text, m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, iso(y, mo, d), 'day');
  }
  for (const m of text.matchAll(MONTH_YEAR)) add(m.index, m.index + m[0].length, iso(Number(m[2]), month(m[1])), 'month');
  for (const m of text.matchAll(MONTH_ONLY)) {
    const mo = month(m[1]);
    add(m.index, m.index + m[0].length, iso(withYear(mo, 0, ref), mo), 'month');
  }
  const refMs = isoToMs(ref);
  for (const m of text.matchAll(RELATIVE)) {
    const offset = m[1].toLowerCase() === 'tomorrow' ? 1 : 0;
    add(m.index, m.index + m[0].length, msToIso(refMs + offset * DAY_MS), 'day');
  }
  for (const m of text.matchAll(WEEKDAY)) {
    const target = WEEKDAYS.indexOf(m[2]);
    let delta = (target - new Date(refMs).getUTCDay() + 7) % 7;
    if (m[1] === 'next' && delta < 3) delta += 7;
    add(m.index, m.index + m[0].length, msToIso(refMs + delta * DAY_MS), 'day');
  }

  // Keep the most specific match where matches overlap; drop a relative date that
  // is immediately followed by an absolute one ("on Friday, October 23").
  found.sort((a, b) => (a.precision === b.precision ? 0 : a.precision === 'day' ? -1 : 1) || (b.end - b.start) - (a.end - a.start));
  const kept = [];
  for (const f of found) {
    if (kept.some((k) => f.start < k.end && k.start < f.end)) continue;
    kept.push(f);
  }
  return kept
    .filter((f) => !kept.some((k) => k !== f && k.precision === 'day' && k.start >= f.end && k.start - f.end <= 3 && /^(?:today|tomorrow|tonight|this|on|coming|from|next)/i.test(text.slice(f.start, f.end))))
    .sort((a, b) => a.start - b.start);
}

// ---------- cue words ----------

const STREAM_CUE = /\b(?:OTT|stream\w*|digital\w*|premier\w*|land(?:s|ed|ing)?\s+on|arriv\w*\s+on|available\s+(?:on|to\s+(?:stream|watch))|drop(?:s|ped|ping)?\s+on|watch\s+(?:it\s+)?on|where\s+to\s+watch|rights|platforms?)\b/gi;
const OTHER_CUE = /\b(?:theat(?:re|er)\w*|cinemas?|big\s+screens?|box[\s-]office|IMAX|halls?|announc\w*|unveil\w*|revealed|trailer|teaser|poster|shoot\w*|wrapped|birthday|screened|festival|interview)\b/gi;
const HEDGE_CI = /\b(?:expected|likely|reportedly|rumou?r\w*|buzz|speculat\w*|tentative\w*|unconfirmed|not\s+(?:yet\s+)?(?:been\s+)?(?:officially\s+)?confirmed|if\s+reports|sources|anticipated|tipped|said\s+to\s+be|might)\b/i;
const HEDGE_CS = /\b(?:may|could)\b/;
const OFFICIAL = /\b(?:officially|announced|confirmed|unveiled|took\s+to\s+(?:social\s+media|Instagram|X|Twitter)|official\s+(?:handle|announcement|poster))\b/i;
const NOW = /\b(?:now\s+streaming|streaming\s+now|started\s+streaming|began\s+streaming|(?:is|are)\s+(?:now\s+)?streaming|(?:is|are)\s+now\s+available|has\s+(?:landed|arrived|premiered|dropped)|out\s+now|now\s+available|reached\s+\w+\s+on)\b/i;
const TBA = /\b(?:yet\s+to\s+be\s+(?:announced|revealed|confirmed|disclosed)|not\s+(?:yet\s+)?(?:been\s+)?(?:officially\s+)?(?:announced|revealed|disclosed)|to\s+be\s+announced|TBA|under\s+wraps|remains?\s+unannounced)\b/i;
const HEADLINE_OFFICIAL = /\b(?:confirmed|OUT|announced|officially|locked)\b/;
const SERIES_WORD = /\b(?:web\s*series|series|season|episodes?|docu-?series|show)\b/gi;
const FILM_WORD = /\b(?:film|movie|biopic)\b/gi;
const LANG_WORD = /\b(Hindi|Tamil|Telugu|Malayalam|Kannada|Bengali|Bangla|Marathi|Punjabi|Gujarati|Odia|Bhojpuri|Bollywood|Kollywood|Tollywood|Mollywood|Sandalwood|Korean|Japanese|Hollywood)\b/;
const LANG_CODE = {
  hindi: 'hi', bollywood: 'hi', tamil: 'ta', kollywood: 'ta', telugu: 'te', tollywood: 'te', malayalam: 'ml', mollywood: 'ml',
  kannada: 'kn', sandalwood: 'kn', bengali: 'bn', bangla: 'bn', marathi: 'mr', punjabi: 'pa', gujarati: 'gu', odia: 'or',
  bhojpuri: 'bh', korean: 'ko', japanese: 'ja', hollywood: 'en',
};

function cueSpans(text, re) {
  return [...text.matchAll(re)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}
// Cue words usually come before the date they govern ("streaming from <date>",
// "in theatres on <date>"), so a cue after the date counts as farther away.
const distance = (date, cue) => (cue.end <= date.start ? date.start - cue.end : cue.start >= date.end ? (cue.start - date.end) * 1.5 : 0);

// "ConfirmedBiju" -> "Confirmed Biju", "MAXStreaming" -> "MAX Streaming": restores
// word boundaries lost when tables are flattened. Platform names like "SonyLIV"
// and "ManoramaMAX" stay intact (an uppercase run is not split).
export function deglue(text) {
  return text.replace(/(\p{Ll})(\p{Lu}\p{Ll})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll}{2,})/gu, '$1 $2');
}

// A date is a streaming date when the closest cue to it is a streaming cue.
function streamingDates(text, ref, platforms) {
  const stream = [...cueSpans(text, STREAM_CUE), ...platforms];
  const other = cueSpans(text, OTHER_CUE);
  return findDates(text, ref).filter((d) => {
    const sd = Math.min(Infinity, ...stream.map((c) => distance(d, c)));
    const od = Math.min(Infinity, ...other.map((c) => distance(d, c)));
    return sd <= 160 && sd < od;
  });
}

function certaintyOf(text) {
  if (HEDGE_CI.test(text) || HEDGE_CS.test(text)) return 'speculative';
  if (NOW.test(text) || OFFICIAL.test(text)) return 'official';
  return 'reported';
}

function guessLanguage(text) {
  const m = text.match(LANG_WORD);
  return m ? LANG_CODE[m[1].toLowerCase()] : null;
}

function guessType(title, text) {
  if (/\bseason\s*\d+\b|\bS\d{1,2}\b/i.test(title)) return 'series';
  const s = (text.match(SERIES_WORD) ?? []).length;
  const f = (text.match(FILM_WORD) ?? []).length;
  return s > f ? 'series' : 'movie';
}

// ---------- titles ----------

// Single words that are also film titles but appear constantly in entertainment news.
const STOP = new Set(('love hero action family friday monday tuesday wednesday thursday saturday sunday today tomorrow ' +
  'premiere release stream streaming india indian hindi tamil telugu malayalam kannada bengali marathi punjabi season series ' +
  'film films movie movies cinema october november december january february march april may june july august september ' +
  'boss king queen mother father brother sister police thriller drama comedy horror romance ghost animal war crime ' +
  'trailer teaser music story star stars actor actress director netflix prime video jiohotstar hotstar zee5 sonyliv aha ' +
  'box office review reviews collection world nation city home life time power game games show shows part chapter ' +
  'official update watch where when weekend week one two three four five six seven eight nine ten eleven twelve ' +
  'twenty hundred first second third last next new top best latest').split(/\s+/));

// Lowercase words used in a set of articles. A one-word title that also shows
// up as an ordinary lowercase word ("will", "reality", "dark") is too ambiguous
// to match in prose.
export function commonWords(texts) {
  const counts = new Map();
  for (const t of texts) for (const w of t.match(/\b\p{Ll}{3,}\b/gu) ?? []) counts.set(w, (counts.get(w) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n >= 2).map(([w]) => w));
}

// entries: [{ title, language, type, year, force? }]. `force` keeps short or
// common-word titles (used for headline-derived titles).
export function compileDictionary(entries, { common = new Set() } = {}) {
  const byKey = new Map();
  for (const e of entries) {
    const title = String(e.title ?? '').trim();
    const core = title.replace(/^the\s+/i, '').trim();
    const key = normalizeTitle(title);
    if (!key || byKey.has(key)) continue;
    if (!e.force) {
      const single = !/\s/.test(core);
      if (core.length < 4 || /^\d/.test(core)) continue;
      if (single && (STOP.has(core.toLowerCase()) || common.has(core.toLowerCase()))) continue;
    }
    byKey.set(key, { ...e, title, core, key });
  }
  const list = [...byKey.values()].sort((a, b) => b.core.length - a.core.length);
  const pattern = (core) => `(?:(?:The|the|THE)\\s+)?${escapeRe(core).replace(/['’]/g, "['’]").replace(/\s+/g, '\\s+')}`;
  const re = list.length ? new RegExp(list.map((e) => pattern(e.core)).join('|'), 'gu') : null;
  return { byKey, re };
}

// Capitalised words that may follow a title without making it part of a longer
// name ("Dorothy Trailer", "Gajab Raat OTT").
const OK_NEXT = new Set(('OTT Trailer Teaser Review Reviews Box Release Releases Released Streaming Streams Stream Movie Film ' +
  'Series On In To And Is Will Now Full Cast Story Plot Where When Watch Online Premiere Premieres Arrives Lands Hits Gets ' +
  'Date Platform Director Genre Starring Language Rating Runtime Synopsis Digital Hindi Tamil Telugu Malayalam Kannada ' +
  'Bengali Marathi Punjabi Gujarati Directed Written Produced Set Also The A An This That It Its').split(/\s+/));

// Rejects a match that is really part of a longer name: "Honey" in "Honey Bunch",
// "Jack" in "Jack Ryan", "Sikandar" in "Sikandar ka Mukaddar", "Mark" in "Tom Mark".
function partOfLongerName(text, start, end, entry) {
  if (/^ \d/.test(text.slice(end, end + 2))) return true; // "Dhurandhar 2" is a sequel, not "Dhurandhar"
  const next = text.slice(end).match(/^ (?:(ka|ki|ke) )?(\p{Lu}[\p{L}\d'’]*)/u);
  if (next) {
    const [, connector, word] = next;
    if (connector) return true;
    if (/^(?:Season|Part|Chapter|Vol)$/.test(word)) {
      if (entry.type !== 'series') return true;
    } else if (!OK_NEXT.has(word) && !findPlatforms(word).length) {
      return true;
    }
  }
  const prev = text.slice(Math.max(0, start - 30), start).match(/(\p{Lu}\p{L}*) $/u);
  return !!prev && !OK_NEXT.has(prev[1]) && !findPlatforms(prev[1]).length;
}

export function findTitles(text, dict) {
  if (!dict.re) return [];
  const out = [];
  for (const m of text.matchAll(dict.re)) {
    const start = m.index;
    const end = start + m[0].length;
    if (badEdges(text, start, end)) continue;
    const entry = dict.byKey.get(normalizeTitle(m[0]));
    if (!entry || (!entry.force && partOfLongerName(text, start, end, entry))) continue;
    out.push({ start, end, entry });
  }
  return out;
}

const HEADLINE_PATTERNS = [
  /^(.{2,80}?)\s+(?:OTT|Ott)\b/,
  /^(.{2,80}?)\s+(?:(?:is\s+)?(?:now\s+)?streaming|streams|to\s+(?:stream|premiere|arrive|land|drop)|premieres|arrives|lands|drops)\s+(?:on|from)\b/i,
  /^(.{2,80}?)\s+(?:digital\s+(?:premiere|release|debut|rights)|streaming\s+(?:date|rights|platform|partner))\b/i,
];

// Pulls the title out of single-title headlines; null for round-ups and others.
export function headlineTitle(headline) {
  if (ROUNDUP.test(headline)) return null;
  for (const re of HEADLINE_PATTERNS) {
    const m = headline.match(re);
    if (!m) continue;
    let t = m[1].replace(/^(?:exclusive|watch|confirmed|breaking|official|update|big\s+update|it['’]s\s+official)\s*[:|–-]\s*/i, '');
    // A quoted title wins: "Vijay Sethupathi starrer ‘Baththa’" -> "Baththa".
    const quoted = t.match(/[‘'"“]([\p{Lu}\d][^‘’'"“”]{1,59})[’'"”]/u);
    if (quoted) t = quoted[1];
    t = t
      .replace(/^.*\bstarrer\s+/i, '')
      .replace(/^[‘'"“]+|[’'"”]+$/g, '').trim()
      .replace(/^(?:\p{Lu}[\p{L}.]*\s+){0,2}\p{Lu}[\p{L}.]*['’]s\s+(?=[\p{Lu}\d‘'"“])/u, '')
      .replace(/^[‘'"“]+|[’'"”]+$/g, '').trim()
      .replace(/(?<!\bThe)\s+(?:movie|film|web\s*series|series)$/i, '').trim()
      .replace(/(?:\s+(?:on|in|to|at|from|now|is|set|gets|and))+$/i, '').trim();
    if (/\bEpisode\b/i.test(t) || /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(?:\d{4}|\d{1,2})\b/.test(t)) return null;
    const words = t.split(/\s+/);
    if (words.length > 7 || t.length < 2 || t.length > 60) return null;
    if (/\b(?:releases|this\s+week|weekend|movies|shows|films|titles)\b|\?/i.test(t)) return null;
    // "Netflix Announces Anand Deverakonda's Epic OTT Release Date" is not a title.
    if (/\b(?:announces?|reveals?|confirms?|gets?|bags?|sets?|locks?|finali[sz]es?|update|details?|date|when|where|how|why|what|here['’]s|new|latest|upcoming)\b|(?<!\b(?:It|it|That|Let))['’]s\b/i.test(t)) return null;
    // Nor is a sentence: "The Paradise becomes fastest ever ...". Titles' lowercase
    // words are connectors ("Sikandar ka Mukaddar", "Love in Disguise").
    const loose = words.filter((w) => /^\p{Ll}/u.test(w) && !/^(?:ka|ki|ke|ko|se|aur|mein|me|of|the|and|in|a|an|to|for|on|with|de|la|da|di|vs)$/.test(w));
    if (loose.length >= 2) return null;
    if (!/^[\p{Lu}\d]/u.test(t) || findPlatforms(t).some((p) => p.end - p.start === t.length)) return null;
    return t;
  }
  return null;
}

// ---------- extraction ----------

function toIstDate(published, fallback) {
  if (!published) return fallback;
  const ms = Date.parse(published);
  return Number.isNaN(ms) ? fallback : msToIso(ms + 330 * 60e3);
}

function splitSentences(text) {
  return text.split(/(?<=[.!?])\s+(?=[\p{Lu}\d‘'"“])|\n+/u).map((s) => s.trim()).filter(Boolean);
}

function fact(entry, extra, contextText) {
  return {
    title: entry.title,
    type: entry.type ?? guessType(entry.title, contextText),
    language: entry.language ?? guessLanguage(contextText),
    year: entry.year ?? null,
    ...extra,
  };
}

function extractSingle(article, focus, dict, ref) {
  const focusDict = compileDictionary([focus]);
  const sentences = splitSentences(`${article.title}\n${article.text || ''}`);
  const evidence = [];
  sentences.forEach((raw, i) => {
    const mentionsFocus = findTitles(raw, focusDict).length > 0;
    const others = findTitles(raw, dict).filter((m) => m.entry.key !== focus.key && !focus.key.includes(m.entry.key));
    if (others.length && !mentionsFocus) return;
    const s = deglue(raw);
    const platforms = findPlatforms(s);
    if (!platforms.length && !/\b(?:OTT|stream\w*|digital\w*)\b/i.test(s)) return;
    evidence.push({ s, i, platforms, dates: TBA.test(s) ? [] : streamingDates(s, ref, platforms) });
  });

  const counts = new Map();
  for (const e of evidence) {
    for (const id of new Set(e.platforms.map((p) => p.id))) counts.set(id, (counts.get(id) ?? 0) + (e.i === 0 ? 2 : 1));
  }
  const platform = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const rank = (e) => (HEDGE_CI.test(e.s) || HEDGE_CS.test(e.s) ? 2 : OFFICIAL.test(e.s) || NOW.test(e.s) ? 0 : 1);
  const dated = evidence
    .filter((e) => e.dates.length && (!e.platforms.length || e.platforms.some((p) => p.id === platform)))
    .sort((a, b) => rank(a) - rank(b) || a.i - b.i);
  const best = dated[0];
  if (!platform && !best) return [];

  const about = evidence.filter((e) => !platform || e.platforms.some((p) => p.id === platform) || !e.platforms.length);
  let certainty = best ? certaintyOf(best.s) : about.every((e) => rank(e) === 2) ? 'speculative' : about.some((e) => rank(e) === 0) ? 'official' : 'reported';
  if (certainty === 'reported' && HEADLINE_OFFICIAL.test(article.title) && !HEDGE_CI.test(article.title)) certainty = 'official';
  const context = `${article.title}\n${(article.text || '').slice(0, 1500)}`;
  return [fact(focus, {
    platform,
    date: best?.dates[0].iso ?? null,
    streaming_now: about.some((e) => NOW.test(e.s)),
    certainty,
  }, context)];
}

const LIST_GLUE = /^[\s,&;]*(?:and|or|&)?[\s\p{L}'’.-]{0,40}$/u;
// Lines in "Title / Where to watch: X / Streaming Date: Y" style listings.
const FIELD_LINE = /^\s*(?:\d+\.\s*)?(?:Where\s+to\s+(?:watch|stream)|(?:OTT\s+)?Platform|Streaming\s+(?:on|date|platform|partner)|(?:OTT\s+)?Release\s+date|Premiere\s+date|Languages?|Cast|Starring|Genre|Director|Directed\s+by|Runtime|Rating|Episodes|Available\s+on|Watch\s+on)\b/i;
const ABBREV = /(?:\b(?:Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|Dr|Mr|Mrs|Ms|St|Jr|Sr|No|Rs|vs)|\b\p{Lu})$/u;

// End of the text that describes a title mention: its own sentence, plus any
// field-style lines that follow it.
function scopeEnd(text, from, limit) {
  let i = from;
  while (i < limit) {
    const ch = text[i];
    if (ch === '\n') {
      let j = i + 1;
      for (;;) {
        const lineEnd = text.indexOf('\n', j) === -1 ? text.length : text.indexOf('\n', j);
        const line = text.slice(j, lineEnd);
        if (!(FIELD_LINE.test(line) || /^\S{1,15}$/.test(line.trim())) || j >= limit) break;
        j = lineEnd + 1;
      }
      return Math.min(j > i + 1 ? j - 1 : i, limit);
    }
    if ((ch === '.' || ch === '!') && /^(?:\s|\p{Lu}|$)/u.test(text[i + 1] ?? '') && !ABBREV.test(text.slice(Math.max(0, i - 5), i))) {
      return i + 1;
    }
    i++;
  }
  return limit;
}

function extractMulti(article, dict, ref) {
  const text = article.text || article.title;
  const mentions = findTitles(text, dict);
  const scopes = mentions.map((m, i) => {
    const next = mentions.slice(i + 1).find((n) => n.entry.key !== m.entry.key && n.start >= m.end);
    const limit = Math.min(next ? next.start : text.length, m.end + SCOPE_CHARS);
    const scope = deglue(text.slice(m.end, scopeEnd(text, m.end, limit)));
    // "Udta Teer and Little Thomas arrive in cinemas." — a theatrical mention;
    // whatever follows belongs to the next item.
    const firstSentence = scope.split(/[.!?\n]/).find((s) => s.trim()) ?? '';
    if (/\b(?:theat(?:re|er)s?|cinemas?|big\s+screens?)\b/i.test(firstSentence) && !/\b(?:OTT|stream\w*|digital\w*)\b/i.test(firstSentence) && !findPlatforms(firstSentence).length) {
      return { m, scope: firstSentence, next, platform: null, date: null, theatrical: true };
    }
    // "Prime Video's The Terminal List": a possessive platform belongs to what follows.
    const platforms = findPlatforms(scope).filter((p) => !/^['’]s\b/.test(scope.slice(p.end, p.end + 3)));
    const dates = streamingDates(scope, ref, platforms);
    return { m, scope, next, platform: platforms[0]?.id ?? null, date: dates[0] ?? null };
  });

  // "Gajab Raat, Dorothy and Sumo Didi land on October 23": list items borrow
  // the platform/date of the item that ends the list.
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (s.theatrical || s.platform || s.date || !s.next || s.scope.length > 45 || !LIST_GLUE.test(s.scope)) continue;
    const donor = scopes.find((o) => o.m === s.next);
    if (donor?.theatrical) s.theatrical = true;
    else if (donor && (donor.platform || donor.date)) Object.assign(s, { platform: donor.platform, date: donor.date, scope: donor.scope, borrowed: true });
  }

  const byTitle = new Map();
  for (const s of scopes) {
    if (!s.platform && !s.date) continue;
    if (!byTitle.has(s.m.entry.key)) byTitle.set(s.m.entry.key, { entry: s.m.entry, obs: [] });
    byTitle.get(s.m.entry.key).obs.push(s);
  }

  const facts = [];
  for (const { entry, obs } of byTitle.values()) {
    const platforms = [...new Set(obs.map((o) => o.platform).filter(Boolean))];
    const context = obs.map((o) => o.scope).join(' ');
    if (!platforms.length) {
      const o = obs.find((x) => x.date);
      facts.push(fact(entry, { platform: null, date: o.date.iso, streaming_now: false, certainty: certaintyOf(o.scope) }, context));
      continue;
    }
    for (const p of platforms) {
      const withP = obs.filter((o) => o.platform === p);
      const o = withP.find((x) => x.date) ?? (platforms.length === 1 ? obs.find((x) => x.date) : null) ?? withP[0];
      facts.push(fact(entry, {
        platform: p,
        date: o.date?.iso ?? null,
        streaming_now: withP.some((x) => NOW.test(x.scope)),
        certainty: certaintyOf(o.scope),
      }, context));
    }
  }
  return facts;
}

// Returns facts in the same shape merge.factToClaim() expects (minus `article`).
export function extractFromArticle(article, dict, today) {
  const ref = toIstDate(article.published, today);
  const t = headlineTitle(article.title);
  if (t) {
    const key = normalizeTitle(t);
    const known = dict.byKey.get(key);
    const focus = known ?? { title: t, key, force: true, core: t.replace(/^(the|a|an)\s+/i, '') };
    return extractSingle(article, { ...focus, force: true }, dict, ref);
  }
  return extractMulti(article, dict, ref);
}
