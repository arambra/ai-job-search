---
name: remotive-search
version: 1.0.0
description: >
  Use this skill to search Remotive (remotive.com), a remote-only job board with a
  global, English-language market, via Remotive's official public API, or to look up
  one Remotive posting. It reports each job's eligible candidate locations and can
  keep only remote jobs a resident of a given country (e.g. Canada) may apply to.
  Trigger phrases: search Remotive, Remotive jobs, find remote jobs, remote-only job
  search, work from anywhere jobs, worldwide remote roles, remote jobs open to Canada,
  "which remote jobs can I apply to from <country>", look up this Remotive posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/remotive-search/cli/src/cli.ts *)
---

# Remotive Search Skill

Search remote job listings from **[Remotive](https://remotive.com)** through its
**official public API** (`GET https://remotive.com/api/remote-jobs`, documented at
[remotive-com/remote-jobs-api](https://github.com/remotive-com/remote-jobs-api)).
No API key, **zero runtime dependencies** - it runs with just `bun`. Every job is
remote; the question is *where from*, so each result carries Remotive's
`candidate_required_location` as `location` and as an `eligible_regions` list, and
`--country` keeps only jobs a resident of that country is eligible for.

## ⚠️ Terms & limits

- **robots.txt conflict, recorded.** `remotive.com/robots.txt` disallows `/api/*`
  (and `/*search=`, `/job/detail/*`, `/remote-job/detail/*`). Remotive nevertheless
  publishes and documents this API for developers; the user chose to use the
  official API only. The skill never fetches the robots-disallowed HTML job pages.
- **Attribution required.** Remotive's terms: link back to the Remotive job URL and
  mention Remotive as the source, or API access is terminated. Every result's `url`
  is the Remotive URL - keep it when you show or store a job, and credit Remotive.
  Do not republish Remotive jobs to third-party sites (Jooble, Google Jobs, LinkedIn
  Jobs...). Personal job-search use only.
- **Rate limit.** Remotive advises calling the API "a couple of times a day (max. 4)";
  **more than 2 requests per minute are blocked**. The CLI makes **one request per
  command** and caches responses on disk for 6 hours (`REMOTIVE_CACHE_TTL_MIN`), and
  `detail` reuses a cached search response, so `search` + `detail` is one request.
  Do not loop the CLI over many queries - run one broad search and filter.
- **Delayed listings.** Public API jobs are delayed by 24 hours; the freshest
  postings are only on remotive.com.
- **Small public feed.** The public endpoint currently returns a small sample of
  active jobs (12 at the time of writing) and **ignores its documented `search`,
  `category`, `company_name` and `limit` parameters** - the CLI still sends them, then
  applies the same filters client-side. Expect few results for niche terms.

## Commands

### Search

```bash
bun run .agents/skills/remotive-search/cli/src/cli.ts search [-q "<keywords>"] [flags]
```

- `--query` / `-q <text>` - case-insensitive partial match of the **whole phrase**
  against title and description (the API's documented `search` semantics). Multiple
  words are a phrase, not an OR.
- `--country` / `-c <name>` - keep only jobs a resident of that country may apply to
  (rule below). Names or common codes: `canada`/`ca`, `usa`/`us`, `uk`, `germany`...
- `--category <name|slug>` - Remotive category, e.g. `software-development`, `devops`,
  `data`, `qa`, `product`, `supply-chain`, `information-technology`.
- `--company <name>` - company name, partial match.
- `--jobage <days>` - posted within N days (client-side, by `publication_date`).
- `--page <n>` (1-indexed) and `--limit` / `-n <n>` (default 25) - client-side paging.
- `--no-description` - drop descriptions from JSON results for a light discovery pass.
- `--format json|table|plain` - default `json`.

There is no `--location` flag: every Remotive job is remote; eligibility is `--country`.

### Detail

```bash
bun run .agents/skills/remotive-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is a search result's `id`; a `https://remotive.com/remote-jobs/<category>/<slug>-<id>`
URL works too. The public API has no per-job endpoint, so `detail` resolves the id
from one job-list response (a fresh cached search response first, else one request).
A job no longer in the public feed exits 1 with `NOT_FOUND`.

## Country eligibility rule (`--country`)

A job is kept when its `candidate_required_location`:

1. names the country or an alias (Canada: `Canada`; US: `USA`, `US`, `United States`...), **or**
2. names a region containing it (Canada/US: `North America`, `Americas`; UK/EU
   countries: `Europe`, `EMEA`, (`EU` for EU members); Brazil etc.: `LATAM`,
   `Latin America`; Australia: `APAC`, `Oceania`...), **or**
3. names a worldwide term: `Worldwide`, `Anywhere`, `Global`, `International`,

matched as whole words, case-insensitive. A country named **after** an exclusion
word (`except`, `excluding`, `exclude`, `not in`, `outside`) disqualifies the job
("Worldwide except Canada" is dropped). An empty location is treated as **not**
eligible. Countries outside the built-in table match only their own name plus the
worldwide terms. Timezone-only entries count by name: "USA, Canada, USA timezones"
is eligible for Canada; check the description for timezone overlap requirements.

## Usage examples

```bash
# Remote developer jobs a Canada resident can apply to
bun run .agents/skills/remotive-search/cli/src/cli.ts search -q "developer" --country canada --format table

# Integration roles (niche - often 0 on the small public feed)
bun run .agents/skills/remotive-search/cli/src/cli.ts search -q "integration" --country canada --format table

# Software-development category, posted in the last 14 days
bun run .agents/skills/remotive-search/cli/src/cli.ts search --category software-development --jobage 14 --format table

# DevOps roles open to US residents, JSON without descriptions
bun run .agents/skills/remotive-search/cli/src/cli.ts search --category devops --country usa --no-description

# Everything in the feed open to Canada (one request; filter afterwards)
bun run .agents/skills/remotive-search/cli/src/cli.ts search -c ca --limit 50 --format plain

# Full posting
bun run .agents/skills/remotive-search/cli/src/cli.ts detail 2091135 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default - programmatic use; carries descriptions, tags, salary, job_type |
| `table` | Quick scan: id, title, company, eligible location, type, salary, date |
| `plain` | Readable blocks; `detail --format plain` prints the full description |

Search JSON: `{ "meta": { "count", "page", "total", "feed_size", "country", "source" }, "results": [...] }`.
Each result: `id`, `title`, `company`, `location` (= `candidate_required_location`),
`eligible_regions` (that string split on `,` `;` `/` `|` `or`), `date` (`YYYY-MM-DD`),
`url` (Remotive URL - keep it for attribution), `category`, `job_type`
(`full-time`, `contract`, `part-time`, `freelance`, `internship`; often unset),
`salary` (free text as posted, often USD/yearly but sometimes monthly/hourly, often
unset), `tags`, `description` (HTML stripped). Missing values are `null`, never
omitted. `detail` adds `published_at`, `company_logo`, `source`. Errors go to
**stderr** as `{ "error": "...", "code": "..." }` with exit code 1.

## Notes

- Market: global remote, English. Volume on the public feed is small; the live
  smoke test uses `-q developer` (not the niche "integration developer", which
  returned 0 of 12 at build time) to guarantee at least one result.
- `salary` is not normalized - compare only like periods and currencies.
- Cache: `REMOTIVE_CACHE_TTL_MIN` (minutes, default 360; `0` disables) and
  `REMOTIVE_CACHE_DIR` (default `<tmp>/remotive-cli-cache`).
- 429/5xx are retried with exponential backoff + jitter (2 s doubling, `Retry-After`
  honored, 60 s budget); a 429 that persists means the rate limit - wait, don't retry.
