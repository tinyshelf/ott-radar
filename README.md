# OTT Radar

A mobile-friendly site that tracks **upcoming and recent OTT releases in India**: where each title streams, when, and how sure that date is.

JustWatch knows what is streaming *now*, but it is slow on announced dates and patchy for regional Indian films. OTT Radar reads the Indian entertainment press instead, twice a day, and cross-checks the outlets against each other.

**Running cost: zero.** No paid APIs, no AI services, no server. It runs entirely on free GitHub Actions and GitHub Pages.

## How it works

```
Google News India (14 searches) ─┐
Publisher RSS (123telugu,        ├─► headlines ─► filter ─► article text ─► rule-based extractor ─► claims.json
 Pinkvilla, Indian Express, …)  ─┘                                          (title, platform, date, certainty)

Known titles: Wikipedia "List of <language> films of <year>" (+ TMDB if a key is set)

claims (+ optional TMDB posters/availability) ─► merge.mjs ─► releases.json ─► static site
```

**Extraction** (`scripts/lib/rules.mjs`) uses no AI. It handles two kinds of article:

- **Single-title stories** ("Jailer 2 OTT release date: …"): the title comes from the headline. Platform and date are pooled from every sentence about streaming.
- **Round-ups** ("OTT releases this week"): known titles are found in the text, and each one takes the platform and date in its own sentence or in "Where to watch: / Streaming date:" lines.

A date counts only when the closest cue word is about streaming, not theatres, announcements or trailers. Hedged wording ("expected", "reportedly", "not confirmed") marks a claim as a rumour.

**Merging** (`scripts/lib/merge.mjs`) treats every fact as a *claim* from one outlet. For each title and platform it:

- ignores reports more than 21 days older than the newest one, which handles postponements
- prefers official announcements, then the date backed by the most distinct outlets
- drops platforms that only a small minority of outlets mention, which are usually a neighbouring title's platform picked up by mistake
- labels the result **Confirmed** (official, 2+ outlets agree, or JustWatch shows it streaming), **Reported** (one outlet), or **Rumoured** (only hedged reports)

Rule-based extraction makes mistakes that an AI model wouldn't. The labels and the cross-checking contain most of them: a wrong fact from one article stays "Reported", while popular titles end up backed by 10–30 outlets. Tap any card to see the source articles.

## Setup

1. **Make the repo public.** GitHub Pages is free only for public repos. The repo holds no secrets, only public news data.
2. **Pages**: Settings → Pages → *Build and deployment* → Source: **GitHub Actions**.
3. **Optional, recommended, free**: get a TMDB key at https://www.themoviedb.org/settings/api, then add it under Settings → Secrets and variables → Actions → New repository secret, named `TMDB_API_KEY`. Either the v3 key or the v4 read token works. It adds posters, cast, IMDb ratings, web series titles and "streaming now" data from JustWatch.
4. **First run**: Actions → *Update data and deploy* → *Run workflow*. After that it runs at 06:00 and 18:00 IST.

The optional repo variable `MAX_ARTICLES` (default 100) caps how many articles each run reads.

**Backfilling older news:** Actions → *Update data and deploy* → *Run workflow* has a `backfill_days` box. Enter e.g. `60` to also read the last 60 days of news (up to 500 articles, about 15 minutes). Normal runs leave it at 0.

## Local use

```sh
npm test
npm run update      # full refresh (TMDB_API_KEY optional)
npm run rebuild     # rebuild releases.json from stored data only
npm run serve       # http://localhost:8080, or /phone for a phone-sized frame
```

Debugging the extractor:

```sh
node scripts/update.mjs --collect=articles.json   # fetch feeds + article text, stop
node scripts/update.mjs --dry=articles.json       # print what the extractor finds
node scripts/update.mjs --from=articles.json      # full run on saved articles
```

## Files

| Path | What |
|---|---|
| `index.html`, `assets/` | The site: plain HTML, CSS and JS with no build step |
| `data/releases.json` | What the site reads (generated) |
| `data/claims.json` | Every extracted claim with its source URL (append-only) |
| `data/titles.json` | Known-title list from Wikipedia/TMDB, refreshed daily |
| `data/tmdb.json` | TMDB cache (only used with a key) |
| `data/imdb.json` | IMDb ratings for our titles, from IMDb's daily dataset (needs the TMDB key for IMDb ids) |
| `data/seen.json` | Articles already processed in the last 30 days |
| `scripts/update.mjs` | The pipeline entry point |
| `scripts/lib/rules.mjs` | The extractor; tests in `test/rules.test.mjs` |
| `scripts/lib/sources.mjs` | Feed list and headline filters, the first place to edit when adding sources |
| `scripts/lib/platforms.mjs` | Platform names, aliases and colours |

## Notes

- Google News links are decoded with the same undocumented call the Google News web app makes. Calls are spaced out. If Google rate-limits or changes it, those articles are retried next run, and publisher RSS feeds keep working.
- This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data comes from JustWatch via TMDB. Known-title lists come from Wikipedia (CC BY-SA).
- IMDb ratings come from IMDb's [non-commercial datasets](https://data.imdb.com/non-commercial-datasets/), which are licensed for personal, non-commercial use only. Information courtesy of IMDb (https://www.imdb.com). Used with permission.
