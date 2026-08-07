# Compass

An evidence-first job opportunity workspace for graduate students and early-career professionals. It finds roles automatically from official sources, judges each one against your actual profile, and shows its reasoning — instead of a mystery match score or an auto-apply bot that fires off applications you never reviewed.

## Principles

- **Evidence, not vibes.** Every eligibility, fit, effort, and attention judgement names the exact text or profile fact behind it.
- **Honest uncertainty.** "Not stated" is never treated as "not eligible." Nothing is fabricated — not an applicant count, not a skill you don't have, not an interview stage the employer never mentioned.
- **You decide, you submit.** Compass prepares and assists; it never applies on your behalf.
- **Source-respecting discovery.** Only official APIs and licensed feeds (Greenhouse, Lever, Ashby, Adzuna) are polled automatically. LinkedIn and Facebook posts are still genuinely useful early leads, but reading them requires software that violates those platforms' terms of service to run at any real scale — LinkedIn pursued exactly this (hiQ Labs) to a permanent injunction and the end of that company. Compass treats a pasted LinkedIn/Facebook post as a manually-captured lead instead, and tries to verify it against the employer's own official listing.

## Quick start

```
npm install
npm start
```

Your browser should open to `http://localhost:4173` automatically. If it doesn't (e.g. a headless environment), open that address yourself — **not** the `index.html` file directly, which browsers block from running scripts when opened straight from disk.

Works with zero configuration: a small example watch-list in `server/config.json` (a real Greenhouse board, Lever's own always-on demo board, Ashby's own board) populates the Discover panel immediately.

### Adding your own companies (free, no keys)

Create `server/config.local.json` (git-ignored, won't be committed) to add your own watch-list without touching the shipped example:

```json
{
  "greenhouse": [{ "name": "Some Company", "boardToken": "somecompany" }],
  "lever": [{ "name": "Another Co", "site": "anotherco" }],
  "ashby": [{ "name": "A Startup", "jobBoardName": "astartup" }],
  "adzuna": { "enabled": true, "country": "gb", "what": "embedded software engineer", "where": "" },
  "maxPostingAgeDays": 365,
  "refreshIntervalMinutes": 360
}
```

The board token/site/job-board name is usually the slug in the company's careers URL (`boards.greenhouse.io/somecompany`, `jobs.lever.co/anotherco`, `jobs.ashbyhq.com/astartup`). Not every company uses one of these three ATS platforms — if you can't find a match, paste that role manually instead.

### Optional API keys

Copy `.env.example` to `.env` and fill in whichever you're using — both are entirely optional, and this `.env` file is the *only* place any key ever goes:

| Keys | Unlocks | Get them from |
|---|---|---|
| `ADZUNA_APP_ID`, `ADZUNA_APP_KEY` | More discovered roles, on top of Greenhouse/Lever/Ashby | Free: <https://developer.adzuna.com> |
| `LLM_PROVIDER`, `LLM_API_KEY` | CV upload (auto-fills your profile) and "Read with AI" on any posting | Any of: `anthropic`, `openai`, `gemini`, or `openai-compatible` (covers Groq, Mistral, DeepSeek, OpenRouter, a local Ollama server — set `LLM_BASE_URL` too) |

## Using it

1. **Profile** — fill in degree, skills, location, and experience by hand, or (with an `LLM_API_KEY` set) upload a CV (PDF/.txt/.md) and review what it filled in. This is what every eligibility and match check runs against.
2. **Discovered roles** — fills itself in automatically and refreshes every `refreshIntervalMinutes`, or hit **Refresh**, which also sends your current specialism/skills so Adzuna's search reflects them, not just the static config default. Once your profile has skills, every role gets a live match score and the list sorts by it. Use the **match slider**, **posted-within** selector (defaults to 4 months), **show-count** selector, and the **search bar** to narrow hundreds of results down to what's actually worth your time. Click **Analyse** to load any role into the workspace.
3. **A role or lead** — paste anything not auto-discovered (a LinkedIn/Facebook post, a company site) here by hand.
4. **Decision brief** — eligibility, evidence overlap, effort, and attention, each with its supporting evidence. "Read with AI" (if configured) re-reads the posting with a model instead of the built-in rules.
5. **Save to tracker** — kept entirely in your browser; export or clear it anytime from the tracker section.

## How it's built

A vanilla JS PWA (`index.html`, `src/`) talks to a small Node.js server (`server/index.mjs`) — no frontend framework, no database, no npm dependency beyond `pdf-parse` for CV text extraction. The server:

- polls Greenhouse/Lever/Ashby/Adzuna's public APIs on a timer and caches the pool to a JSON file (`server/data/`, git-ignored);
- optionally calls whichever LLM provider you've configured for CV/posting reading (`server/reader/`);
- otherwise just serves the static files.

Domain logic (`src/estimation.js`, `src/role-analysis.js`) is dependency-free, pure, and unit-tested — the same functions run whether a role came from auto-discovery or a manual paste.

### Adding another job source

Each `server/sources/*.mjs` file follows the same shape: fetch, normalise into the shared `buildJobRecord()` format (`server/normalize.mjs`), done. Greenhouse's file is the shortest to copy from. Verified, currently-existing options beyond what's already wired in:

- **Workable** — public widget endpoint (`apply.workable.com/api/v1/widget/accounts/{account}`), confirmed to exist; exact JSON field names not verified against a live response.
- **Recruitee**, **Personio** — both have public feeds too (Personio's is XML, more integration work).
- **Reed.co.uk** — a genuine official API (`reed.co.uk/developers/jobseeker`), broader than Adzuna; field casing not verified live.
- **jobs.ac.uk** (UK academic/PhD listings) — the strongest lead for PhD/studentship search. It explicitly publishes RSS feeds *for this exact purpose* ("an ideal method of displaying our job listings on your website"), by subject area and location — a legitimate mechanism, unlike scraping. The one missing piece is the literal feed URL: `jobs.ac.uk/feeds` lists them by category, but the link itself needs pulling from a browser (tool access here strips hrefs from fetched pages). Note this one returns XML/RSS, not JSON, so its adapter needs a small feed parser rather than `JSON.parse`.
- **jobs.ac.uk / general job boards via paid scraper APIs** — exist, but not used here: same ToS-risk category as LinkedIn/Facebook, ruled out for the same reason.

None of the unverified ones above are implemented blind — a wrong field-name guess here either fails loudly (caught by the existing per-source error isolation) or silently returns thin data, and it's cheaper to verify once than debug it later.

## Known limitations 

- Posting/CV understanding is regex-based by default; the optional AI reader costs one model call per use, so it's on-demand (a button), not automatic across every discovered role.
- Adzuna doesn't expose a structured remote/hybrid field, so that signal falls back to text inference for Adzuna-sourced roles.
- .docx CVs aren't supported yet (PDF and .txt/.md are).
- Neither the discovery APIs nor the AI reader have been tested against a live call from inside the environment this was built in — its network access is restricted to a fixed allowlist that excludes every job API and LLM provider. Everything is verified as far as possible without that: current official docs, a real live-fetched sample for Lever, a real generated PDF through the actual extraction path, and mocked-but-realistic responses for parsing logic. Check your own `npm start` output the first time.

## Testing

```
npm test
```

Pure domain logic and the source/reader adapters are unit-tested against real fixtures (`test/`). Live network calls aren't — see the limitation above.

## Licence

GPL-3.0. See [LICENSE](LICENSE).
