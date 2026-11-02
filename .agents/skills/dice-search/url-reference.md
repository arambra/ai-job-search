# Dice URL & Parsing Reference

Investigated 2026-11-01 with the honest UA `Mozilla/5.0 (compatible; dice-cli/1.0)`.
Plain `fetch`, no cookies, no JavaScript - every request below returned HTTP 200.

## Access / terms

`https://www.dice.com/robots.txt` disallows (for all user agents) `/jobs?q*`, `/jobs/?q*`,
`/job` (a prefix that also covers `/job-detail/`), `/jobsearch/`, `/rss/` and `/feed/`.
The user chose to build and use this skill anyway for **low-volume personal use**; SKILL.md
carries the personal-use warning. No login is needed to view listings.

## Search

```
GET https://www.dice.com/jobs?q=<keywords>[&location=<place>][&filters.workplaceTypes=<type>][&filters.postedDate=<bucket>][&page=<n>]
```

| Parameter | CLI flag | Values / notes |
|-----------|----------|----------------|
| `q` | `--query` / `-q` | Free-text keywords. Spaces sent as `%20`. |
| `location` | `--location` / `-l` | US place, e.g. `Chicago, IL`. Server uses a 30 mi radius (`radius`/`radiusUnit=mi` defaults). Omitted = nationwide (`countryCode2=US`). |
| `filters.workplaceTypes` | `--remote` | `Remote`, `Hybrid`, `On-Site` (remote / hybrid / onsite). |
| `filters.postedDate` | `--jobage` | `ONE` (Today), `THREE` (Last 3 Days), `SEVEN` (Last 7 Days). No bucket beyond 7 days. The CLI maps 1 -> ONE, 2-3 -> THREE, 4-7 -> SEVEN and always re-filters client-side on `postedDate`. |
| `page` | `--page` | 1-indexed. Page size is 30 (fixed by the page). |

Other facets seen in the page (not exposed as flags): `employmentType` (`FULLTIME`,
`PARTTIME`, `CONTRACTS`, `THIRD_PARTY`), `employerType`, `easyApply`, `willingToSponsor`.

### Where the results live

The page is a Next.js App Router page. There is **no `__NEXT_DATA__`**; the server-rendered
data is in the React Server Components flight payload, a series of

```html
<script>self.__next_f.push([1,"<JSON string literal>"])</script>
```

tags. JSON-decode each string literal and concatenate them; the resulting text contains

```
"jobList":{"data":[{...},{...}],"meta":{"currentPage":1,"pageSize":30,"facetQueryResults":[...],"pageCount":9,"totalResults":259,...}}
```

This is the response of Dice's internal job-search API (`/v1/dice/jobs/search?...`, called
server-side; the page references it only as a relative `_links.self.href`). No API key is
present in the page and the CLI does not call that API - it parses the embedded blob.

Per-job fields (the CLI JSON-parses each object of `data` independently):

| Dice field | CLI field | Notes |
|------------|-----------|-------|
| `guid` | `id` | UUID; the key for `/job-detail/<guid>`. |
| `id` | `diceId` | 32-hex internal id; not usable for detail. |
| `title` | `title` | |
| `companyName` | `company` | |
| `jobLocation.displayName` | `location` | Absent for many remote jobs -> `null`. |
| `postedDate` | `date` | ISO 8601, e.g. `2026-10-28T15:36:28Z`. Also `modifiedDate`. |
| `detailsPageUrl` | `url` | `https://www.dice.com/job-detail/<guid>`. |
| `workplaceTypes` | `workplace` | Array: `["Remote"]`, `["Hybrid"]`, `["Remote","On-Site"]`, ... |
| `isRemote` | `isRemote` | Boolean. |
| `employmentType` | `employmentType` | Comma string: `Full-time`, `Contract`, `Third Party`, `Part-time`. |
| `employerType` | `employerType` | `Direct Hire` / `Recruiter`. |
| `salary` | `salary` | Free text, e.g. `Depends on Experience`. |
| `easyApply` | `easyApply` | Boolean. |
| `summary` | `summary` | First ~500 chars of the description, plain text. |

The rendered cards also exist as HTML (`data-testid="job-search-job-card-link"`,
`data-testid="job-card-company-name"`), but the flight blob is richer and is what the CLI uses.
If the `"jobList":{"data":` anchor is missing, the CLI exits 1 with `PARSE_FAILED`.

## Detail

```
GET https://www.dice.com/job-detail/<guid>
```

| Source | CLI fields |
|--------|------------|
| `<script type="application/ld+json" id="jobDetailStructuredData">` (schema.org `JobPosting`) | `title`, `description` (HTML -> text), `datePosted` -> `date`, `validThrough`, `url`, `hiringOrganization.name` -> `company`, `jobLocation[].address` -> `location`, `jobLocationType` (e.g. `TELECOMMUTE`), `employmentType` (e.g. `CONTRACTOR`, `FULL_TIME`), `baseSalary` -> `salary`, `applicantLocationRequirements.name` -> `applicantLocation` (e.g. `USA`) |
| Header-card badges: `<div class="SeuiInfoBadge ...">` inside `data-testid="job-detail-header-card"`, before the `Company Branding Image` / `Job Details` section | `badges` (all), `workplace` (`data-testid="locationTypeBadge"`), `contractDuration` (`data-testid="contractDurationBadge"`), `employmentTypes` (un-tagged badges starting Contract / Full Time / Part Time / Third Party ...: e.g. `Contract Corp To Corp`, `Contract Independent`, `Contract W2`) |
| Flight payload `"skills":[...]` | `skills` |

A 404/410 maps to `NOT_FOUND`; a 200 page with no JobPosting JSON-LD also returns `NOT_FOUND`.

## Quirks

- Facet counts in `meta.facetQueryResults` for the active facet ignore that facet's own filter
  (e.g. with `Remote` selected the workplace facet still lists On-Site counts).
- A job can carry several workplace types (`["Remote","On-Site"]`), and still match the Remote filter.
- Summary text sometimes drops apostrophes (`TSPs`) - that is Dice's data, not a decoding bug.
