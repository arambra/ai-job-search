---
name: himalayas-search
version: 1.0.0
description: >
  Use this skill to search live remote-only job listings on Himalayas (himalayas.app),
  a global remote job board, via its free public JSON API, or to look up a specific
  Himalayas posting. Every result carries the countries a candidate must live in
  (eligible_countries, or worldwide), so it answers "which remote jobs can I take from
  Canada/the US". Covers global remote roles in English, strongest for tech, integration,
  engineering, product and operations roles. Trigger phrases: search Himalayas, remote
  jobs, find remote jobs I can do from Canada, remote integration developer jobs,
  remote EDI jobs, work from home jobs, remote-friendly roles open to Canada, look up
  this Himalayas job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/himalayas-search/cli/src/cli.ts *)
---

# Himalayas Search Skill

Search live **remote** job listings from **[Himalayas](https://himalayas.app)** through
its documented, free [Remote Jobs API](https://himalayas.app/api). No sign-up, no API
key, and **zero runtime dependencies** - it runs with just `bun`. Every Himalayas job is
remote; what varies is **where the candidate may live**, which this skill exposes on each
result so you can keep only jobs a Canada-based (or any-country) candidate is eligible for.

## Terms of use (API)

Himalayas' terms (clause 30A and the "Terms and Conditions for API Users", clause 113,
at <https://himalayas.app/terms#api>) explicitly allow use of the public API within its
documented rate limits, and allow a "Personal Agent" acting for one person. Keep to that:

- **Personal job search only** - do not republish, pass on, or feed these jobs to other
  job boards, aggregators or search engines, and do not collect them in bulk.
- **Apply through `apply_url`** (the API's `applicationLink`) unchanged, and credit
  Himalayas as the source when showing a job.
- **Keep volume low.** Without a key every caller shares one public allowance; the data
  refreshes daily, so there is no benefit to polling more often.

## When to use this skill

- Find remote roles by keyword that are open to candidates in a given country (`--country CA`)
- Filter by seniority, employment type, company, timezone, or recency
- Look up one Himalayas posting (full description, salary, eligibility, expiry) or check
  whether it is still open

## Commands

### Search

```bash
bun run .agents/skills/himalayas-search/cli/src/cli.ts search [-q "<keywords>"] [filters]
```

| Flag | Meaning |
|------|---------|
| `--query`, `-q <text>` | Free-text query (title, skill, role). |
| `--country`, `-c <country>` | **Server-side eligibility filter**: only jobs open to candidates in this country. ISO alpha-2, name, slug or abbreviation (`CA`, `Canada`, `US`). Worldwide jobs (no country restriction) are **included** unless you add `--exclude-worldwide`. |
| `--exclude-worldwide` | With `--country`: drop worldwide jobs, keep only those that name the country. |
| `--worldwide` | Only worldwide-friendly jobs. |
| `--jobage <days>` | Posted/updated within N days. **Client-side** filter on `pubDate` (the API has no age parameter); sets `--sort recent` unless you chose a sort. Filters only the fetched page, so `count` can be below 20. |
| `--seniority <list>` | Comma list of `Entry-level, Mid-level, Senior, Manager, Director, Executive` (case-insensitive). |
| `--employment-type <list>` | Comma list of `Full Time, Part Time, Contractor, Temporary, Intern, Volunteer, Other`. |
| `--company <slug>` | Company slug(s), comma-separated (a result's `company_slug`). |
| `--timezone <offset>` | UTC offset, e.g. `-5`, `UTC-5`, `UTC+05:30`. |
| `--sort <order>` | `relevant` (default) \| `recent` \| `salaryAsc` \| `salaryDesc` \| `nameAToZ` \| `nameZToA` \| `jobs`. |
| `--page <n>` | 1-indexed page. The API serves **20 jobs per page**. |
| `--limit`, `-n <n>` | Client-side cap on results shown (at most 20 per page). |
| `--format json\|table\|plain` | Default `json`. |

There is no separate `--location`: Himalayas is remote-only, and geography is the
`--country` eligibility filter (plus `--timezone`).

### Detail

```bash
bun run .agents/skills/himalayas-search/cli/src/cli.ts detail <company/slug|url> [--format json|plain]
```

Takes a search result's `id` (e.g. `unlimited-potential/integration-developer`) or a
`https://himalayas.app/companies/<company>/jobs/<slug>` URL (the `url` or `apply_url`
field). Returns the full description as plain text plus every search field. A closed job
exits 1 with code `JOB_CLOSED` (HTTP 410); an unknown one with `NOT_FOUND`.

## Usage examples

```bash
# Remote integration developer roles open to someone living in Canada
bun run .agents/skills/himalayas-search/cli/src/cli.ts search -q "integration developer" --country CA --format table

# EDI roles open to Canada, posted/updated in the last 14 days
bun run .agents/skills/himalayas-search/cli/src/cli.ts search -q "EDI" --country Canada --jobage 14 --format table

# Senior full-time Azure integration roles that explicitly list Canada (no worldwide)
bun run .agents/skills/himalayas-search/cli/src/cli.ts search -q "azure integration" --country CA --exclude-worldwide --seniority senior --employment-type "full time" --format table

# Best-paid matches first, Eastern-time friendly
bun run .agents/skills/himalayas-search/cli/src/cli.ts search -q "integration engineer" --country CA --timezone -5 --sort salaryDesc --format table

# Second page of results
bun run .agents/skills/himalayas-search/cli/src/cli.ts search -q "integration developer" --country CA --page 2 --format table

# Full detail for one job
bun run .agents/skills/himalayas-search/cli/src/cli.ts detail unlimited-potential/integration-developer --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default - programmatic use (`/scrape`); carries every field |
| `table` | Quick scanning: id, title, company, eligible countries, salary, date |
| `plain` | Readable blocks; for `detail`, the full description |

Search JSON is `{ "meta": { "count", "page", "total", "page_size" }, "results": [...] }`.
`total` is Himalayas' estimate (can be a day old); `page_size` is how many jobs the API
returned before `--jobage`/`--limit`. Each result has these fields, `null`/`[]` when
absent, never omitted:

| Field | Notes |
|-------|-------|
| `id` | `<company>/<slug>` - pass to `detail` |
| `title`, `company`, `company_slug` | entities decoded |
| `location` | readable string: `Remote (Canada)`, `Remote (Canada, United States)`, `Remote (Worldwide)`, long lists abbreviated `+N more` |
| `eligible_countries` | full `locationRestrictions` array (English country names); `[]` means worldwide |
| `worldwide` | `true` when there is no country restriction |
| `timezones` | allowed UTC offsets (`timezoneRestrictions`) |
| `date` | `pubDate` as `YYYY-MM-DD` - **last updated**, not necessarily first posted |
| `expiry_date` | latest listing date (jobs can close earlier) |
| `url` | the Himalayas job page (guid) |
| `apply_url` | the API's `applicationLink` - use it for applying |
| `employment_type`, `seniority[]`, `categories[]` | |
| `salary` | e.g. `CAD 90000-120000/annual`; plus `salary_min`, `salary_max`, `salary_currency`, `salary_period` |
| `excerpt` | first sentences of the description (search); `detail` adds `description` |

Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`
(`BAD_ARG`, `UNKNOWN_FLAG`, `NO_ID`, `BAD_ID`, `NOT_FOUND`, `JOB_CLOSED`,
`SEARCH_FAILED`, `DETAIL_FAILED`).

## Notes

- **Eligibility rule (Himalayas' own):** a job is open to a country when
  `locationRestrictions` is empty or includes it, **and** `timezoneRestrictions` includes
  one of that country's standard UTC offsets (Canada: -8 to -3.5). `--country` applies the
  country half server-side; check `timezones` (or pass `--timezone`) for the other half.
- **Worldwide jobs are included by `--country`** by default. For a Canada-only shortlist
  add `--exclude-worldwide`; for anything else, `worldwide: true` means no country limit.
- **Rate limits:** no key needed; keyless requests share one public allowance across all
  callers (not numerically documented). A free key raises it to 60 requests/minute and
  10,000/UTC day per account - export it as `HIMALAYAS_API_TOKEN` (env var only, never a
  flag) and the CLI sends `Authorization: Bearer ...`. The single-job check endpoint allows
  60 requests/minute without a key. Over the limit returns 429; the CLI backs off
  exponentially with jitter (honouring `Retry-After`, 30 s budget). Cached responses are free.
- **Pagination:** search pages hold up to 20 jobs and can hold fewer before the end;
  results can shift between pages, so dedupe on `id`. Keep requesting until a page is empty.
- **robots.txt** allows `/` but disallows `?page=` on HTML listing pages and `/apply`; this
  CLI never fetches HTML, only the `/jobs/api/*` JSON endpoints.
- Without `-q`, the default sort ranks by recent activity, not by `pubDate`.
- Some postings are in French (Quebec employers) - the query matches either language.
- Company names can arrive HTML-encoded (`H&amp;H Group`); they are decoded, but the
  slug in `id` keeps the encoding (`h-amp-h-group/...`).
- Himalayas also offers an MCP server and an RSS feed (100 most recent jobs); this skill
  uses only the JSON API.
