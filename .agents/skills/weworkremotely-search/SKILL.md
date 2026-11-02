---
name: weworkremotely-search
version: 1.0.0
description: >
  Use this skill whenever the user wants to search We Work Remotely
  (weworkremotely.com), the remote-only job board, for fully remote jobs
  open globally or to a region (US, Canada, North America, Europe, LATAM),
  check which remote jobs they are eligible for from their country, or look
  up a specific We Work Remotely posting. Market: global remote, English.
  Trigger phrases: We Work Remotely, WWR, weworkremotely, remote jobs, fully
  remote, work from anywhere, remote job board, remote jobs open to Canada,
  "remote X jobs I can apply to from <country>", look up this WWR posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/weworkremotely-search/cli/src/cli.ts *)
---

# We Work Remotely Search Skill

Search live listings on **We Work Remotely** (https://weworkremotely.com), a remote-only job
board with a global, English-language market. No authentication, no API key, and **zero
runtime dependencies** — it runs with just `bun`.

Every job on WWR is remote, but most are **geo-restricted**. Each result therefore carries
a `region` field with the job's applicant eligibility exactly as WWR shows it
(`"Anywhere in the World"`, `"USA Only"`, `"North America Only"`, `"Canada Only"`, or a list of
countries), and `location` is set to the same value. Use `--eligible <country>` to keep only
jobs someone in that country may apply for.

Access: `robots.txt` allows the search, category and job pages (it disallows only
admin/account/manage paths). Keep volume low anyway — one request per `search`, one per `detail`.

## When to use this skill

- Find remote jobs by keyword on We Work Remotely
- Keep only the jobs open to applicants in a given country (`--eligible Canada`)
- Browse a whole WWR category (back-end, DevOps, product, ...)
- Get the full description, eligibility and posting date of a specific WWR job

## Commands

### Search job listings

```bash
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search --query "<keywords>" [flags]
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search --category <key> [flags]
```

At least one of `--query` / `--category` is required (WWR has no unfiltered listing endpoint).

Key flags:
- `--query <text>` / `-q <text>` — keywords. WWR matches them as a **substring** of the job title / company name, so short terms over-match (`EDI` hits "Media", "Editor", "Credit").
- `--exact` — keep only results where every query word is a whole word in the title/company (fixes the `EDI` case).
- `--category <key>` / `-c <key>` — one of `full-stack-programming`, `front-end-programming`, `back-end-programming`, `devops-sysadmin`, `design`, `product`, `customer-support`, `sales-and-marketing`, `management-and-finance`, `all-other` (the full slug, e.g. `remote-devops-sysadmin-jobs`, also works). Alone it lists the whole category; with `--query` it filters the keyword results to that category.
- `--eligible <country>` — keep jobs whose region is "Anywhere in the World", names the country, or is a group that covers it (`North America Only` counts for Canada, USA and Mexico). Jobs with no region information are dropped.
- `--jobage <days>` — posted within N days. Applied client-side to the listing's relative age (`New`, `4d`, `28d`); "New" counts as 0 days.
- `--page <n>` — 1-indexed page of 25 results (client-side; WWR returns all matches on one page).
- `--limit <n>` / `-n <n>` — cap total results emitted (client-side).
- `--format json|table|plain` — default `json`.

There is no `--location` flag: every job is remote, and eligibility is handled by `--eligible`.

### Fetch full job detail

```bash
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts detail <id|url> [--format json|plain]
```

`id` is the job slug from `search` results (e.g. `legion-senior-integration-engineer`); a full
`https://weworkremotely.com/remote-jobs/<slug>` URL also works. Returns the full description,
region/eligibility, ISO applicant countries, exact posting date, apply-before date, job type,
category, HQ and salary (when the employer gave one).

## Usage examples

```bash
# Integration roles a Canadian resident can apply for
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -q "integration" --eligible Canada --format table

# EDI roles, whole-word match only (avoids "Media"/"Editor" substring hits)
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -q "EDI" --exact --format table

# Back-end engineer roles open to Canada, posted in the last 7 days
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -q "engineer" -c back-end-programming --eligible Canada --jobage 7 --format table

# Every DevOps/Sysadmin job open to North America
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts search -c devops-sysadmin --eligible Canada --format table

# Full detail for one posting
bun run .agents/skills/weworkremotely-search/cli/src/cli.ts detail legion-senior-integration-engineer --format plain
```

## Output formats

| Format | Best for |
|--------|----------|
| `json` | Default — programmatic use, passing ids to `detail`. `{ meta: { count, page, total, pageSize }, results: [...] }` |
| `table` | Quick human-readable scanning (id, title, company, region, date) |
| `plain` | Reading a single job's full detail (`detail` command) |

Search result fields: `id`, `title`, `company`, `location` (= `region`), `region`, `regions`
(the individual pills), `date` (approximate `YYYY-MM-DD`, UTC), `age` (raw `New`/`4d`), `ageDays`,
`jobType`, `salary`, `hq`, `categoryId`, `category`, `featured`, `url`. Missing values are
`null`, never omitted.

All errors are written to **stderr** as `{ "error": "...", "code": "..." }` and the process exits with code `1`.

## Notes

- Data comes from the server-rendered search page (`/remote-jobs/search?term=`), category
  pages (`/categories/<slug>`) and job pages (`/remote-jobs/<slug>`). The RSS feeds
  (`/remote-jobs.rss`, `/categories/<slug>.rss`) exist but the main feed holds only the newest
  100 jobs (10 per category) and there is no keyword RSS (`/remote-jobs/search.rss` returns 406),
  so the HTML search page has far better recall. See `url-reference.md`.
- Niche terms return few results: on 2026-11-01 `integration developer` returned 0 jobs,
  `integration` 1 and `EDI --exact` 0. Search broader (`integration`, `engineer` + a category)
  and read the descriptions.
- Search dates are approximate (cards show only a relative age; "New" covers roughly the last
  two days). `detail` returns the exact `datePosted` from the page's JSON-LD.
- The apply button on job pages requires a free WWR account; the CLI does not return an apply URL.
- Paid "Promoted" ad cards on the search page are skipped.
- The CLI retries 429/5xx with exponential backoff and jitter.
