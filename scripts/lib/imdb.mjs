// IMDb ratings from IMDb's free daily dataset (personal, non-commercial use):
// https://developer.imdb.com/non-commercial-datasets/ — about 9 MB gzipped.
// Titles are linked to IMDb ids through TMDB, so this needs TMDB_API_KEY.
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';

// Picks { id: [rating, votes] } for the wanted ids out of the dataset's lines
// ("tconst\taverageRating\tnumVotes").
export async function pickRatings(lines, ids) {
  const out = {};
  let found = 0;
  for await (const line of lines) {
    const id = line.slice(0, line.indexOf('\t'));
    if (!ids.has(id)) continue;
    const [, rating, votes] = line.split('\t');
    out[id] = [Number(rating), Number(votes)];
    if (++found === ids.size) break;
  }
  return out;
}

export async function fetchRatings(ids) {
  if (!ids.size) return {};
  const res = await fetch(RATINGS_URL, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`IMDb dataset HTTP ${res.status}`);
  const input = Readable.fromWeb(res.body).pipe(createGunzip());
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    return await pickRatings(lines, ids);
  } finally {
    lines.close();
    input.destroy();
  }
}
