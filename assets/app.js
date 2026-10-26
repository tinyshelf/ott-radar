const PAGE = 60;
const STATUS_LABEL = { confirmed: 'Confirmed', reported: 'Reported', rumored: 'Rumoured' };

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage unavailable (private mode); preferences just won't persist.
    }
  },
};

const state = {
  tab: 'upcoming',
  q: '',
  lang: store.get('lang', 'all'),
  platform: store.get('platform', null),
  type: store.get('type', 'all'),
  hideRumored: store.get('hideRumored', false),
  saved: new Set(store.get('saved', [])),
  limit: PAGE,
  open: new Set(),
};

let DATA = { releases: [], platforms: {}, languages: {} };
const $ = (s, el = document) => el.querySelector(s);

// ---------- dates (all in IST) ----------
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const toDate = (iso) => new Date(`${iso.length === 7 ? iso + '-01' : iso}T00:00:00Z`);
const addDays = (iso, n) => new Date(toDate(iso).getTime() + n * 86400e3).toISOString().slice(0, 10);
const weekStart = (iso) => addDays(iso, -((toDate(iso).getUTCDay() + 6) % 7)); // Monday
const fmtDay = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const fmtMonth = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtShort = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function whenLabel(s) {
  if (!s.date) return s.available ? 'Streaming now' : 'Date not announced';
  if (s.precision === 'month') return fmtMonth.format(toDate(s.date));
  if (s.date === TODAY) return 'Today';
  if (s.date === addDays(TODAY, 1)) return 'Tomorrow';
  if (s.date === addDays(TODAY, -1)) return 'Yesterday';
  const label = fmtDay.format(toDate(s.date));
  return s.date.slice(0, 4) === TODAY.slice(0, 4) ? label : `${label} ${s.date.slice(0, 4)}`;
}

// A stream is "out" once it is available or its exact date has passed.
function isOut(s) {
  if (s.available) return true;
  if (!s.date) return false;
  return s.precision === 'day' ? s.date <= TODAY : s.date < TODAY.slice(0, 7);
}

// ---------- grouping ----------
function upcomingGroup(date, precision) {
  if (!date) return { key: 'z', label: 'Date not announced' };
  if (precision === 'month') return { key: `m${date}`, label: fmtMonth.format(toDate(date)) };
  const thisWeek = weekStart(TODAY);
  if (date < addDays(thisWeek, 7)) return { key: 'a', label: 'This week' };
  if (date < addDays(thisWeek, 14)) return { key: 'b', label: 'Next week' };
  return { key: `m${date.slice(0, 7)}`, label: fmtMonth.format(toDate(date.slice(0, 7))) };
}

function outGroup(date) {
  const thisWeek = weekStart(TODAY);
  if (date >= thisWeek) return { key: 'a', label: 'This week' };
  if (date >= addDays(thisWeek, -7)) return { key: 'b', label: 'Last week' };
  return { key: `m${date.slice(0, 7)}`, label: fmtMonth.format(toDate(date.slice(0, 7))) };
}

// ---------- filtering ----------
function matchesFilters(r) {
  if (state.type !== 'all' && r.type !== state.type) return false;
  if (state.lang !== 'all' && r.language !== state.lang) return false;
  if (state.q) {
    const hay = [r.title, r.original_title, ...(r.cast ?? []), r.director, ...r.streams.map((s) => platformName(s))]
      .filter(Boolean).join(' ').toLowerCase();
    if (!state.q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function streamVisible(s) {
  if (state.platform && s.platform !== state.platform) return false;
  if (state.hideRumored && s.status === 'rumored') return false;
  return true;
}

// Returns [{ group, items: [{ release, sortKey }] }] for the current tab.
function buildView() {
  const rows = [];
  for (const r of DATA.releases) {
    if (!matchesFilters(r)) continue;
    const streams = r.streams.filter(streamVisible);
    if (!streams.length) continue;

    if (state.tab === 'saved') {
      if (!state.saved.has(r.id)) continue;
      const next = streams.find((s) => !isOut(s)) ?? streams[streams.length - 1];
      rows.push({ release: r, focus: streams, sortKey: next.date ?? '9999', group: isOut(next) ? { key: 'b', label: 'Out now' } : { key: 'a', label: 'Coming up' } });
      continue;
    }
    const wantOut = state.tab === 'out';
    const focus = streams.filter((s) => isOut(s) === wantOut);
    if (!focus.length) continue;
    if (wantOut) {
      const latest = focus.map((s) => s.date?.length === 10 ? s.date : s.first_seen).sort().pop();
      rows.push({ release: r, focus, sortKey: latest, group: outGroup(latest) });
    } else {
      const first = focus[0];
      rows.push({ release: r, focus, sortKey: first.date ?? '9999', group: upcomingGroup(first.date, first.precision) });
    }
  }

  const desc = state.tab === 'out';
  rows.sort((a, b) => {
    const g = compareGroups(a.group.key, b.group.key, desc);
    if (g) return g;
    const d = desc ? b.sortKey.localeCompare(a.sortKey) : a.sortKey.localeCompare(b.sortKey);
    return d || a.release.title.localeCompare(b.release.title);
  });
  return rows;
}

// Group keys: single letters ("This week", "Next/Last week") come first, then
// month keys ("m2026-11"), ascending for upcoming and descending for out now.
function compareGroups(a, b, desc) {
  const sa = a.length === 1;
  const sb = b.length === 1;
  if (!desc || (sa && sb)) return a.localeCompare(b);
  if (sa !== sb) return sa ? -1 : 1;
  return b.localeCompare(a);
}

// ---------- rendering ----------
function platformName(s) {
  if (!s.platform) return 'Platform TBA';
  return DATA.platforms[s.platform]?.name ?? s.platform_name ?? s.platform;
}
function platformColor(s) {
  return DATA.platforms[s.platform]?.color ?? '#8a8f9c';
}

// 843 -> "843", 12345 -> "12K", 1250000 -> "1.3M"
function formatVotes(n) {
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '')}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

function hue(str) {
  let h = 0;
  for (const ch of str) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style') node.style.cssText = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) node.append(c);
  return node;
}

function streamRow(s, dim) {
  return el('li', { class: `stream${dim ? ' dim' : ''}` },
    el('span', { class: 'pf', style: `--c:${platformColor(s)}` }, platformName(s)),
    el('span', { class: 'when' }, whenLabel(s)),
    el('span', { class: 'status', title: STATUS_LABEL[s.status] }, el('span', { class: `dot ${s.status}` }), STATUS_LABEL[s.status]));
}

function details(r, focus) {
  const box = el('div', { class: 'details' });
  if (r.overview) box.append(el('p', {}, r.overview));
  const facts = [];
  if (r.director) facts.push(['Director', r.director]);
  if (r.cast?.length) facts.push(['Cast', r.cast.join(', ')]);
  if (r.theatrical) facts.push(['In theatres', fmtShort.format(toDate(r.theatrical))]);
  for (const [k, v] of facts) box.append(el('p', {}, el('span', { class: 'k' }, `${k}: `), v));

  for (const s of focus) {
    if (s.conflicts?.length) {
      box.append(el('p', { class: 'warn' }, `${platformName(s)}: other reports say ${s.conflicts.map((d) => whenLabel({ date: d, precision: d.length === 7 ? 'month' : 'day' })).join(', ')}`));
    }
  }

  const sources = r.streams.flatMap((s) => s.sources.map((src) => ({ ...src, platform: platformName(s) })));
  if (sources.length) {
    box.append(el('h4', {}, 'Sources'));
    box.append(el('ul', { class: 'sources' }, sources.slice(0, 10).map((src) => el('li', {},
      el('a', { href: src.url, target: '_blank', rel: 'noopener' }, src.headline || src.outlet),
      el('span', { class: 'src-meta' }, [src.outlet, src.published ? fmtShort.format(new Date(src.published)) : null,
        `${src.platform}${src.date ? ' · ' + whenLabel({ date: src.date, precision: src.date.length === 7 ? 'month' : 'day' }) : ''}`,
        src.certainty === 'speculative' ? 'hedged' : src.certainty === 'official' ? 'official' : null].filter(Boolean).join(' · '))))));
  }

  const links = el('div', { class: 'links' });
  for (const s of focus) {
    const url = DATA.platforms[s.platform]?.url;
    if (url) links.append(el('a', { class: 'btn primary', href: url, target: '_blank', rel: 'noopener' }, `Open ${platformName(s)}`));
  }
  if (r.imdb) links.append(el('a', { class: 'btn', href: `https://www.imdb.com/title/${r.imdb.id}/`, target: '_blank', rel: 'noopener' }, 'IMDb'));
  if (r.tmdb) links.append(el('a', { class: 'btn', href: r.tmdb, target: '_blank', rel: 'noopener' }, 'TMDB'));
  box.append(links);
  return box;
}

function card({ release: r, focus }) {
  const node = $('#card-tpl').content.firstElementChild.cloneNode(true);
  const poster = $('.poster', node);
  if (r.poster) {
    poster.append(el('img', { src: r.poster, alt: '', loading: 'lazy', decoding: 'async' }));
  } else {
    const h = hue(r.title);
    poster.style.background = `linear-gradient(150deg, hsl(${h} 55% 45%), hsl(${(h + 40) % 360} 60% 28%))`;
    poster.textContent = r.title.replace(/^(the|a|an)\s+/i, '').slice(0, 1).toUpperCase();
  }
  $('.title', node).append(r.title, r.year ? el('span', { class: 'yr' }, ` (${r.year})`) : null);
  $('.meta', node).textContent = [DATA.languages[r.language] ?? r.language?.toUpperCase(), r.type === 'series' ? 'Series' : 'Movie', ...(r.genres ?? []).slice(0, 2)]
    .filter(Boolean).join(' · ');
  if (r.imdb?.rating) {
    const imdb = $('.imdb', node);
    imdb.append(el('span', { class: 'logo-imdb' }, 'IMDb'), el('strong', {}, r.imdb.rating.toFixed(1)), `(${formatVotes(r.imdb.votes)} ratings)`);
    imdb.hidden = false;
  }
  const focusSet = new Set(focus);
  $('.streams', node).append(...r.streams.filter(streamVisible).map((s) => streamRow(s, !focusSet.has(s))));

  const main = $('.card-main', node);
  const setOpen = (open) => {
    main.setAttribute('aria-expanded', String(open));
    let det = $('.details', node);
    if (open && !det.childElementCount) {
      const built = details(r, focus);
      det.replaceWith(built);
      det = built;
    }
    det.hidden = !open;
  };
  main.addEventListener('click', () => {
    const open = !state.open.has(r.id);
    open ? state.open.add(r.id) : state.open.delete(r.id);
    setOpen(open);
  });
  if (state.open.has(r.id)) setOpen(true);

  const star = $('.star', node);
  star.setAttribute('aria-pressed', String(state.saved.has(r.id)));
  star.setAttribute('aria-label', state.saved.has(r.id) ? `Unsave ${r.title}` : `Save ${r.title}`);
  star.addEventListener('click', () => {
    state.saved.has(r.id) ? state.saved.delete(r.id) : state.saved.add(r.id);
    store.set('saved', [...state.saved]);
    star.setAttribute('aria-pressed', String(state.saved.has(r.id)));
    renderSavedCount();
    if (state.tab === 'saved') render();
  });
  return node;
}

function renderList() {
  const list = $('#list');
  const rows = buildView();
  list.replaceChildren();
  if (!rows.length) {
    const msg = state.tab === 'saved' ? 'Tap ☆ on any title to save it here.' : 'Nothing matches these filters.';
    list.append(el('p', { class: 'empty' }, msg));
    return;
  }
  const counts = new Map();
  for (const row of rows) counts.set(row.group.label, (counts.get(row.group.label) ?? 0) + 1);
  let current = null;
  for (const row of rows.slice(0, state.limit)) {
    if (row.group.label !== current) {
      current = row.group.label;
      list.append(el('h2', { class: 'group-h' }, current, el('span', { class: 'count' }, String(counts.get(current)))));
    }
    list.append(card(row));
  }
  if (rows.length > state.limit) {
    const more = el('button', { class: 'more' }, `Show more (${rows.length - state.limit})`);
    more.addEventListener('click', () => { state.limit += PAGE; renderList(); });
    list.append(more);
  }
}

function chip(label, pressed, onClick, extra = {}) {
  const b = el('button', { class: 'chip', 'aria-pressed': String(pressed), ...extra }, ...[].concat(label));
  b.addEventListener('click', onClick);
  return b;
}

function renderChips() {
  const langCounts = new Map();
  const platCounts = new Map();
  for (const r of DATA.releases) {
    langCounts.set(r.language, (langCounts.get(r.language) ?? 0) + 1);
    for (const s of r.streams) if (s.platform) platCounts.set(s.platform, (platCounts.get(s.platform) ?? 0) + 1);
  }
  // The data file lists the covered languages in display order.
  const setLang = (v) => () => { state.lang = v; store.set('lang', v); render(); };
  const langs = Object.keys(DATA.languages).filter((l) => langCounts.has(l));
  if (state.lang !== 'all' && !langs.includes(state.lang)) state.lang = 'all';
  $('#lang-chips').replaceChildren(
    chip('All languages', state.lang === 'all', setLang('all')),
    ...langs.map((l) => chip(DATA.languages[l], state.lang === l, setLang(l))),
  );

  const setPlat = (v) => () => { state.platform = v; store.set('platform', v); render(); };
  const plats = [...platCounts.entries()].sort((a, b) => b[1] - a[1]).map(([p]) => p).filter((p) => DATA.platforms[p]);
  $('#platform-chips').replaceChildren(
    chip('All platforms', !state.platform, setPlat(null)),
    ...plats.map((p) => chip([el('span', { class: 'swatch', style: `--c:${DATA.platforms[p].color}` }), DATA.platforms[p].name], state.platform === p, setPlat(p))),
  );

  for (const b of $('#type-seg').children) b.setAttribute('aria-pressed', String(b.dataset.type === state.type));
  $('#hide-rumored').checked = state.hideRumored;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === state.tab));
}

function renderSavedCount() {
  const n = DATA.releases.filter((r) => state.saved.has(r.id)).length;
  $('#saved-count').textContent = n ? String(n) : '';
}

function render() {
  state.limit = PAGE;
  renderChips();
  renderList();
  renderSavedCount();
}

// ---------- wiring ----------
function wire() {
  for (const b of document.querySelectorAll('.tabs button')) {
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      history.replaceState(null, '', `#${state.tab}`);
      render();
      window.scrollTo({ top: 0 });
    });
  }
  for (const b of $('#type-seg').children) {
    b.addEventListener('click', () => { state.type = b.dataset.type; store.set('type', state.type); render(); });
  }
  $('#hide-rumored').addEventListener('change', (e) => { state.hideRumored = e.target.checked; store.set('hideRumored', state.hideRumored); render(); });
  let t;
  $('#q').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); state.limit = PAGE; renderList(); }, 120);
  });
  const setHeaderH = () => document.documentElement.style.setProperty('--header-h', `${$('.top').offsetHeight}px`);
  setHeaderH();
  window.addEventListener('resize', setHeaderH);
  const fromHash = location.hash.slice(1);
  if (['upcoming', 'out', 'saved'].includes(fromHash)) state.tab = fromHash;
}

async function init() {
  wire();
  $('#list').append(el('p', { class: 'empty' }, 'Loading…'));
  try {
    const res = await fetch('data/releases.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    DATA = await res.json();
  } catch (err) {
    $('#list').replaceChildren(el('p', { class: 'empty' }, `Couldn't load release data (${err.message}).`));
    return;
  }
  if (DATA.updated_at) {
    const d = new Date(DATA.updated_at);
    $('#updated').textContent = `Updated ${d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}`;
  }
  render();
}

init();
