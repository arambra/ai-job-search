---
name: jobbankca-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search Job Bank Canada (jobbank.gc.ca,
  Guichet-Emplois), the Government of Canada job board, or look for jobs anywhere
  in Canada — including remote / telework jobs, hybrid jobs, or jobs in a specific
  province or Canadian city (Toronto, Ottawa, Montréal, Vancouver, Calgary, ...).
  Also invoke it to fetch the full text of a Job Bank posting. Trigger phrases:
  job bank, jobbank, job bank canada, jobbank.gc.ca, government of canada jobs,
  canada job search, jobs in canada, find a job in canada, remote jobs canada,
  work from home canada, telework canada, jobs ontario, jobs toronto, jobs quebec,
  canadian job postings, NOC occupation jobs, guichet emplois, guichet-emplois,
  guichetemplois, offres d'emploi, offre d'emploi canada, emplois au canada,
  recherche d'emploi, chercher un emploi, trouver un emploi, emplois québec,
  emplois montréal, télétravail, emploi en télétravail, travail à distance,
  emploi hybride, postes vacants.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/jobbankca-search/cli/src/cli.ts *)
---

# Job Bank Canada Search Skill

Search live postings on **Job Bank** (https://www.jobbank.gc.ca), the Government of
Canada's national job board (French: Guichet-Emplois). Job Bank aggregates postings made
directly by employers plus feeds from partner boards (Indeed, Talent.com, SaskJobs, ...).
No authentication, no API key, **zero runtime dependencies** — it runs with just `bun`.

Access: `robots.txt` is `User-agent: *` with `Crawl-delay: 5` and nothing disallowed. The
CLI honours the crawl delay — every request it makes (including across back-to-back
invocations and retries) is spaced at least 5 seconds apart — and identifies itself with an
honest User-Agent (`jobbankca-cli/1.0`). Keep volume reasonable anyway.

## When to use this skill

- Search Canadian job postings by keyword, optionally by province or city
- Find **remote** (telework), hybrid, or on-site jobs with Job Bank's own work-location filter
- Restrict to postings from the last N days
- Get the full detail of one posting, including its `workplace` (remote/hybrid/onsite)

## Commands

### Search job listings

```bash
bun run .agents/skills/jobbankca-search/cli/src/cli.ts search [flags]
```

Flags:
- `--query <text>` / `-q <text>` — keywords (job title or skill). Job Bank maps titles to
  NOC occupations, so results include related titles (e.g. "integration developer" also
  returns "software developer", "Web developer").
- `--location <text>` / `-l <text>` — a province/territory (`ON`, `Ontario`, `QC`, `Québec`)
  or a Canadian city (`Toronto`, `Toronto, ON`; Job Bank's default ~50 km radius). Omit for
  all of Canada. An unrecognised location is an error (`BAD_LOCATION`), never silently dropped.
- `--remote [mode]` — work-location filter: `remote` (the default for a bare `--remote`),
  `hybrid`, or `onsite`. Uses Job Bank's own "Work location" facet.
- `--jobage <days>` — posted within N days. Job Bank only offers 48-hour and 30-day buckets;
  the CLI requests the smallest bucket that covers N and then filters dates exactly.
- `--page <n>` — page number (1-indexed, 25 results per page).
- `--limit <n>` / `-n <n>` — cap results emitted (client-side).
- `--format json|table|plain` — default `json`.

At least one of `--query`, `--location`, `--remote`, `--jobage` is required.

JSON output: `{ "meta": { "count", "page", "total" }, "results": [ { "id", "title",
"company", "location", "date", "url", "workplace", "salary", "source", "sourceJobNumber" } ] }`.
`total` is Job Bank's full hit count; `date` is ISO `YYYY-MM-DD`; missing values are `null`.

### Fetch full job detail

```bash
bun run .agents/skills/jobbankca-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the numeric posting ID from `search` (e.g. `50495396`); a
`https://www.jobbank.gc.ca/jobsearch/jobposting/<id>` URL also works. Returns title,
company, location, `date`, `workplace` (`remote`/`hybrid`/`onsite`/`null`) plus the raw
`workplaceLabel`, salary, employment type, start date, vacancies, source board,
`applyUrl` (employer site or partner-board posting), `deadline` ("Advertised until"),
the full `description`, and `isActive`.

## Usage examples

```bash
# Remote integration-developer jobs anywhere in Canada
bun run .agents/skills/jobbankca-search/cli/src/cli.ts search -q "integration developer" --remote --format table

# Remote EDI jobs posted in the last 30 days
bun run .agents/skills/jobbankca-search/cli/src/cli.ts search -q "EDI" --remote --jobage 30 --format table

# Hybrid software-developer jobs around Toronto
bun run .agents/skills/jobbankca-search/cli/src/cli.ts search -q "software developer" -l "Toronto, ON" --remote hybrid --format table

# Programmer-analyst jobs in Quebec from the last 48 hours
bun run .agents/skills/jobbankca-search/cli/src/cli.ts search -q "programmer analyst" -l QC --jobage 2 --format table

# Second page of Ontario results
bun run .agents/skills/jobbankca-search/cli/src/cli.ts search -q "integration developer" -l Ontario --page 2 --format table

# Full details for one posting
bun run .agents/skills/jobbankca-search/cli/src/cli.ts detail 50495396 --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing IDs to `detail` |
| `table` | Quick human-readable scanning (ID, title, company, location, workplace, date) |
| `plain` | Reading a single job's full detail (`detail` command) |

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process
exits with code `1`.

## Notes

- **Remote search tip:** for remote jobs, omit `--location`. A province/city filter applies
  to the *employer's* location, so `-l ON --remote` hides remote jobs from employers based
  elsewhere in Canada.
- **Workplace on search cards:** only Job Bank-direct postings carry a work-location badge on
  the result card; partner-feed cards (Indeed, Talent.com, SaskJobs, ...) show
  `workplace: null` there even when the job is remote. `--remote` filtering still works for
  them server-side, and `detail` reports the workplace for every posting.
- **Partner postings can disagree with themselves:** Job Bank's work-location field and the
  partner's free-text description occasionally differ (e.g. "Hybrid" on Job Bank, "Work
  Location: Remote" in the Indeed text). Check the description before ruling a job in or out.
- **Descriptions:** Job Bank-direct postings have a structured description (headings and
  bullet lists: tasks, credentials, experience, benefits). Partner postings carry only a
  summary of the partner's text; follow `applyUrl` for the full original posting.
- **Expired postings:** Job Bank redirects a removed posting to `/jobsearch/jobpostingexpired`
  (HTTP 410). `detail` then exits 0 with `isActive: false` and null fields.
- **Keyword matching** is occupation-based (NOC 2021), so expect loosely related titles; the
  `title` field is the posting's own title.
- **Salary** is in CAD as Job Bank shows it (hourly or annual).
- The CLI reads the English site (`jobbank.gc.ca`). Posting text is shown as the employer
  wrote it, so some postings (notably in Quebec) may be in French.
- Requests are spaced ≥ 5 s apart (robots.txt `Crawl-delay: 5`), so a city `--location`
  search (one lookup + one search) takes ~5 s longer than a province search.
