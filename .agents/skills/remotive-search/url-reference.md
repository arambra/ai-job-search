# Remotive - URL / API reference

Investigated 2026-11-01.

## Access decision

| Item | Finding |
|------|---------|
| Data source | Official public API, `GET https://remotive.com/api/remote-jobs` |
| Docs | https://github.com/remotive-com/remote-jobs-api (also linked as https://remotive.com/api-documentation) |
| Auth | None. A private paid API exists (hello@remotive.com, "starting budget $5k/mo") - not used |
| robots.txt | `User-agent: *` disallows `/api/*`, `/*search=`, `/*query=`, `/*category=`, `/*location=`, `/job/detail/*`, `/remote-job/detail/*`, `/jobs/*`, `/v2/feed`, ... |
| Decision | robots.txt conflicts with the documented API. The user chose to use **only the official API**; HTML job pages (`/remote-jobs/...`) are never fetched by the CLI |

## Documented terms & limits

From the README and the `0-legal-notice` field every response carries:

- Access is granted "so that developers can share our jobs further". Do not submit
  Remotive jobs to third-party sites (Jooble, Neuvoo, Google Jobs, LinkedIn Jobs).
- **Link back to the Remotive URL and mention Remotive as a source**, or API access
  is terminated.
- **Jobs are delayed by 24 hours.**
- Using the jobs to collect signups/email addresses is a breach of terms.
- **Rate limit:** "you only need to GET Remotive job data through this API a couple of
  times a day (we advise max. 4 times a day)"; "excessive requests (more than 2x per
  minute) will be blocked".

Design consequences: one request per CLI command; disk cache (default 6 h) keyed by
URL; `detail` first looks the id up in any fresh cached response; everything except
the documented filters is client-side; backoff starts at 2 s with a 60 s budget.

## Endpoints

### `GET /api/remote-jobs`

| Param | Documented meaning | Observed 2026-11-01 |
|-------|--------------------|---------------------|
| `search` | ilike match on title + description | **ignored** (same 12 jobs returned for `search=zzqxnonexistent`) |
| `category` | category name or slug | **ignored** |
| `company_name` | ilike match on company | not probed; CLI re-applies client-side |
| `limit` | max results (default all) | **ignored** (`limit=3` returned 12) |

The CLI sends `search`, `category`, `company_name` (never `limit`, since it pages
client-side) and re-applies all three client-side with the documented semantics,
so results are correct whether or not the server honors them.

Response (top-level keys): `00-warning` (old remotive.io domain notice),
`0-legal-notice`, `job-count`, `total-job-count`, `jobs[]`. At investigation time
`total-job-count` was **12** - the public feed is a small sample, oldest ~4 weeks.

`jobs[]` fields -> CLI fields:

| API field | CLI field | Notes |
|-----------|-----------|-------|
| `id` (int) | `id` (string) | Unique Remotive id |
| `url` | `url` | `https://remotive.com/remote-jobs/<category-slug>/<title-slug>-<id>` |
| `title` | `title` | entity-decoded |
| `company_name` | `company` | |
| `company_logo` | `company_logo` (detail) | |
| `category` | `category` | display name, e.g. "Software Development" |
| `tags[]` | `tags` | trimmed (some carry trailing spaces) |
| `job_type` | `job_type` | `full_time` -> `full-time`; empty -> null |
| `publication_date` | `date` / `published_at` | `2026-10-29T18:22:41`, no timezone (read as UTC) |
| `candidate_required_location` | `location`, `eligible_regions` | free text, e.g. `Worldwide`, `USA, Canada, USA timezones`, `Europe, USA, Canada, APAC` |
| `salary` | `salary` | free text (`$170k - $200k`, `$3.5k–$5k/month`, `$50-$75 /hour`); empty -> null |
| `description` | `description` | HTML; stripped (see below) |

### `GET /api/remote-jobs/categories`

Returns `{jobs: [{id, name, slug}]}` (30 categories). Slugs whose slug is not the
slugified name: `product` (Product Management), `data` (Data and Analytics), `qa`
(Quality Assurance), `education` (Teaching), `travel-hospitality`. Others:
`software-development`, `customer-service`, `design`, `marketing`, `sales`,
`project-management`, `artificial-intelligence`, `devops`, `finance`,
`human-resources`, `writing`, `legal`, `medical`, `account-management`,
`business-development`, `communications`, `compliance`, `engineering`,
`information-technology`, `knowledge-management`, `operations`, `research`,
`strategy`, `supply-chain`, `all-others`. The CLI does not call this endpoint.

## Detail

No per-job API endpoint exists, and `/remote-jobs/...` HTML pages sit next to the
robots-disallowed `/job/detail/*` paths, so `detail <id|url>` takes the id (bare,
or the trailing `-<id>` of a remotive.com URL) and finds it in one job-list
response. Jobs that left the public feed cannot be resolved (`NOT_FOUND`).

## Description cleaning

Descriptions are Google-Docs-style HTML (`<p dir="ltr" style=...><span ...>`),
lists as `<ul><li>` and sometimes `<li><p>`. `cleanHtml`: collapse source
whitespace, `<br>` -> newline, `<li>` -> `- ` bullet, closing block tags -> blank
line, strip tags, decode numeric + common named entities, drop `&nbsp;`, collapse
blank lines (also between bullets).

## Country eligibility

Implemented in `countryRule` / `isEligible` (`cli/src/helpers.ts`); the rule is
documented in SKILL.md. Update the `COUNTRIES` table there when a posting uses a
region term not yet covered.
