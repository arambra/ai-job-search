---
name: dice-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search Dice (dice.com), the large US
  tech job board, for technology jobs in the United States or remote US roles -
  software, integration, EDI, cloud, data, DevOps, SAP, contract (W2 / C2C /
  1099) and full-time positions - or look up a specific Dice job posting.
  Filters by workplace type (remote / hybrid / on-site) and posting age.
  Trigger phrases: search Dice, Dice jobs, dice.com, find tech jobs in the US,
  US remote tech jobs, contract jobs, C2C jobs, corp-to-corp, W2 contract,
  remote integration developer jobs, EDI developer jobs, look up this Dice job.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/dice-search/cli/src/cli.ts *)
---

# Dice Search Skill

Search live job listings on **Dice** (https://www.dice.com), a large US technology job
board, and fetch full posting details. No authentication, no API key, and **zero runtime
dependencies** - it runs with just `bun`. Market: United States, English-language postings,
with strong coverage of contract work (W2, Corp-to-Corp, independent/1099) alongside
full-time roles.

## ⚠️ Personal use only

This reads Dice's public search and job-detail pages. **dice.com's `robots.txt` disallows
the paths this tool uses** - `/jobs?q*` and `/jobs/?q*` (search), `/job` (which covers
`/job-detail/...`), plus `/jobsearch/`, `/rss/` and `/feed/`. The skill was built anyway at
the user's explicit choice, for low-volume personal job searching only. **Keep volume low
(a handful of searches at a time), don't use it commercially or for bulk data collection,
and don't crawl.** Run it on your own responsibility.

## When to use this skill

- Search US tech job openings on Dice, especially fully remote ones
- Filter by workplace type (remote / hybrid / on-site) and recency
- See each posting's employment type (Full-time, Contract, Third Party/C2C) at a glance
- Get the full description, contract terms and skills of a specific Dice posting

## Commands

### Search job listings

```bash
bun run .agents/skills/dice-search/cli/src/cli.ts search --query "<keywords>" [flags]
```

Key flags:
- `--query <text>` / `-q <text>` - **required.** Keywords (job title, skill, technology).
- `--remote <mode>` - `remote`, `hybrid`, or `onsite`. Maps to Dice's `filters.workplaceTypes` (`Remote` / `Hybrid` / `On-Site`).
- `--jobage <days>` - posted within N days. `1`, `2-3` and `4-7` use Dice's own posted-date filter (Today / Last 3 Days / Last 7 Days); every value is **also** enforced client-side on the posted date, so `--jobage 14` or `30` work too but filter only the page that was fetched.
- `--location <text>` / `-l <text>` - a US place, e.g. `"Austin, TX"`. Dice applies a 30-mile radius. Omit for nationwide (and for remote searches).
- `--page <n>` - page number (1-indexed, 30 results per page).
- `--limit <n>` / `-n <n>` - cap total results emitted (client-side).
- `--format json|table|plain` - default `json`.

### Fetch full job detail

```bash
bun run .agents/skills/dice-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job GUID from `search` results (e.g. `a7f7c2dd-df6c-48d3-85b5-c3afa257a72d`).
You may also pass a full `https://www.dice.com/job-detail/<uuid>` URL. Returns the full
description, workplace badge, employment-type badges (e.g. `Contract Corp To Corp`,
`Contract W2`, `Full Time`), contract duration, salary text, applicant-location
requirement, skills, posted and valid-through dates.

## Usage examples

```bash
# Fully remote integration developer roles (the candidate's primary search)
bun run .agents/skills/dice-search/cli/src/cli.ts search -q "integration developer" --remote remote --format table

# Remote EDI roles posted in the last 7 days
bun run .agents/skills/dice-search/cli/src/cli.ts search -q "EDI" --remote remote --jobage 7 --format table

# Remote Azure Logic Apps work, second page of results
bun run .agents/skills/dice-search/cli/src/cli.ts search -q "Azure Logic Apps" --remote remote --page 2 --format table

# Hybrid SAP integration roles around Chicago
bun run .agents/skills/dice-search/cli/src/cli.ts search -q "SAP CPI" -l "Chicago, IL" --remote hybrid --format table

# Full details for a specific job
bun run .agents/skills/dice-search/cli/src/cli.ts detail a7f7c2dd-df6c-48d3-85b5-c3afa257a72d --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default - programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning (ID, title, company, workplace, type, location, date) |
| `plain` | Reading a single job's full detail (`detail` command) |

JSON search output is `{ "meta": { "count", "page", "pageSize", "pageCount", "totalResults" }, "results": [...] }`.
Each result has `id`, `title`, `company`, `location`, `date`, `url`, plus `workplace`
(array such as `["Remote"]` or `["Remote","On-Site"]`), `isRemote`, `employmentType`
(e.g. `"Contract, Third Party"`, `"Full-time"`), `employerType` (`"Direct Hire"` /
`"Recruiter"`), `salary`, `easyApply`, `summary` and `diceId`. Missing values are `null`,
never omitted.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- **US-centric.** Dice is a US board; "Remote" generally means remote *within the US*. The detail
  page's `applicantLocation` (e.g. `USA`) states the requirement - check it before treating a
  remote role as open to a Canada-based candidate.
- **Workplace labels are employer-supplied.** A posting tagged Remote can still say "in-person
  interview" or "occasional travel" in the description - read the detail before applying.
- **Employment type:** search shows Dice's coarse type (`Full-time`, `Part-time`, `Contract`,
  `Third Party`); "Third Party" is Dice's term for Corp-to-Corp/C2C. The detail page has the
  finer badges (`Contract W2`, `Contract Independent`, `Contract Corp To Corp`).
- **Location is often `null`** for remote postings - Dice only sends a location when the employer
  gave one. Use `workplace` / `isRemote` instead.
- The search `id` is Dice's job GUID (the detail-page key). `diceId` is Dice's internal hex id and
  is not accepted by `detail`.
- Page size is fixed at 30. `--jobage` beyond 7 days is a client-side filter on the fetched page
  only, so a page can come back with fewer than 30 results.
- Dice may rate-limit; the CLI retries 429/5xx with exponential backoff and jitter. Keep volume
  low (see the personal-use note above).
- Parsing anchors (the embedded `"jobList"` blob, the JSON-LD `JobPosting`, the header badges)
  are documented in `url-reference.md` for when Dice changes its markup.
