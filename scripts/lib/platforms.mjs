// Canonical OTT platforms available in India. Ids are stable keys used in the
// data files and the site; aliases are matched after normalizePlatformName().
export const PLATFORMS = {
  netflix: { name: 'Netflix', color: '#e50914', url: 'https://www.netflix.com/in/', aliases: ['netflix', 'netflix india'] },
  'prime-video': {
    name: 'Prime Video', color: '#1a98ff', url: 'https://www.primevideo.com/',
    aliases: ['prime video', 'amazon prime video', 'amazon prime', 'prime', 'primevideo', 'amazon video', 'prime video india'],
  },
  jiohotstar: {
    name: 'JioHotstar', color: '#1f4fd8', url: 'https://www.hotstar.com/in',
    aliases: ['jiohotstar', 'jio hotstar', 'hotstar', 'disney+ hotstar', 'disney plus hotstar', 'disney hotstar', 'jiocinema', 'jio cinema', 'jiocinema premium'],
  },
  zee5: { name: 'ZEE5', color: '#8230c6', url: 'https://www.zee5.com/', aliases: ['zee5', 'zee 5', 'zee5 global', 'z5'] },
  sonyliv: { name: 'SonyLIV', color: '#d9a400', url: 'https://www.sonyliv.com/', aliases: ['sonyliv', 'sony liv', 'sony live'] },
  aha: { name: 'aha', color: '#f15a22', url: 'https://www.aha.video/', aliases: ['aha', 'aha video', 'aha tamil', 'aha telugu'] },
  'sun-nxt': { name: 'Sun NXT', color: '#f7931e', url: 'https://www.sunnxt.com/', aliases: ['sun nxt', 'sunnxt', 'sun next'] },
  'amazon-mx-player': {
    name: 'Amazon MX Player', color: '#2b6bff', url: 'https://www.mxplayer.in/',
    aliases: ['amazon mx player', 'mx player', 'amazon minitv', 'minitv', 'mx player ott'],
  },
  'manorama-max': { name: 'ManoramaMAX', color: '#e4002b', url: 'https://www.manoramamax.com/', aliases: ['manoramamax', 'manorama max'] },
  'etv-win': { name: 'ETV Win', color: '#00a0e3', url: 'https://www.etvwin.com/', aliases: ['etv win', 'etvwin'] },
  hoichoi: { name: 'hoichoi', color: '#e8262b', url: 'https://www.hoichoi.tv/', aliases: ['hoichoi', 'hoichoi tv'] },
  'apple-tv': { name: 'Apple TV', color: '#8e8e93', url: 'https://tv.apple.com/in', aliases: ['apple tv', 'apple tv+', 'apple tv plus', 'appletv'] },
  'lionsgate-play': { name: 'Lionsgate Play', color: '#c8a24a', url: 'https://www.lionsgateplay.com/', aliases: ['lionsgate play', 'lionsgateplay'] },
  chaupal: { name: 'Chaupal', color: '#ff7a00', url: 'https://www.chaupal.tv/', aliases: ['chaupal', 'chaupal tv'] },
  'ultra-jhakaas': { name: 'Ultra Jhakaas', color: '#ff2e63', url: 'https://www.ultrajhakaas.com/', aliases: ['ultra jhakaas'] },
  'planet-marathi': { name: 'Planet Marathi', color: '#e94e1b', url: 'https://www.planetmarathi.com/', aliases: ['planet marathi'] },
  'saina-play': { name: 'Saina Play', color: '#00a651', url: 'https://www.sainaplay.com/', aliases: ['saina play', 'sainaplay'] },
  'simply-south': { name: 'Simply South', color: '#f26522', url: 'https://www.simplysouth.tv/', aliases: ['simply south'] },
  tentkotta: { name: 'Tentkotta', color: '#c1272d', url: 'https://www.tentkotta.com/', aliases: ['tentkotta'] },
  shemaroome: { name: 'ShemarooMe', color: '#ffcc00', url: 'https://www.shemaroome.com/', aliases: ['shemaroome', 'shemaroo me'] },
  stage: { name: 'STAGE', color: '#e50000', url: 'https://www.stage.in/', aliases: ['stage', 'stage app', 'stage ott'] },
  waves: { name: 'WAVES', color: '#0066b3', url: 'https://waves.pb.gov.in/', aliases: ['waves', 'waves ott', 'prasar bharati waves'] },
  'discovery-plus': { name: 'discovery+', color: '#2175d9', url: 'https://www.discoveryplus.in/', aliases: ['discovery+', 'discovery plus'] },
  'bms-stream': { name: 'BookMyShow Stream', color: '#c4242b', url: 'https://in.bookmyshow.com/explore/c/stream', aliases: ['bookmyshow stream', 'book my show stream', 'bms stream'] },
  youtube: { name: 'YouTube', color: '#ff0000', url: 'https://www.youtube.com/', aliases: ['youtube', 'youtube movies', 'youtube movies & tv'] },
};

const ALIAS_INDEX = new Map();
for (const [id, p] of Object.entries(PLATFORMS)) {
  ALIAS_INDEX.set(id, id);
  for (const a of p.aliases) ALIAS_INDEX.set(a, id);
}

export function normalizePlatformName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/\b(standard |basic )?with ads\b/g, '')
    .replace(/\bamazon channel\b/g, '')
    .replace(/[™®]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Returns a canonical platform id, or null if the name is unknown/empty.
export function platformId(name) {
  const n = normalizePlatformName(name);
  if (!n) return null;
  if (ALIAS_INDEX.has(n)) return ALIAS_INDEX.get(n);
  // "Netflix India", "Prime Video (rent)", "JioHotstar Super" etc.
  for (const [alias, id] of ALIAS_INDEX) {
    if (alias.length >= 4 && (n.startsWith(alias + ' ') || n.startsWith(alias + '('))) return id;
  }
  return null;
}
