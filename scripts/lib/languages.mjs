// ISO 639-1 codes. INDIAN is the set the site treats as "Indian" by default.
export const LANGUAGES = {
  hi: 'Hindi', ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
  bn: 'Bengali', mr: 'Marathi', pa: 'Punjabi', gu: 'Gujarati', or: 'Odia',
  as: 'Assamese', tu: 'Tulu', bh: 'Bhojpuri', ur: 'Urdu',
  en: 'English', ko: 'Korean', ja: 'Japanese', es: 'Spanish', fr: 'French', zh: 'Chinese', th: 'Thai', tr: 'Turkish',
};

export const INDIAN = new Set(['hi', 'ta', 'te', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu', 'or', 'as', 'tu', 'bh', 'ur']);

// The only languages the site covers, in the order the filter chips show them.
export const WANTED = ['en', 'hi', 'ml', 'ta', 'te', 'kn'];
export const WANTED_INDIAN = WANTED.filter((l) => INDIAN.has(l));

const BY_NAME = new Map(Object.entries(LANGUAGES).map(([code, name]) => [name.toLowerCase(), code]));
BY_NAME.set('bhojpuri', 'bh');
BY_NAME.set('oriya', 'or');
BY_NAME.set('bangla', 'bn');

// Accepts a code ("ta") or a name ("Tamil"); returns a code or null.
export function languageCode(value) {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return null;
  if (LANGUAGES[v]) return v;
  return BY_NAME.get(v) ?? null;
}
