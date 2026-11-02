# Himalayas Remote Jobs API reference

The endpoints, parameters, limits and response shapes this skill depends on. Update this
file if Himalayas changes its API. Sources (verified 2026-11-02): the API docs at
<https://himalayas.app/api>, the OpenAPI 3.1 spec at
<https://himalayas.app/docs/openapi.json>, and the terms at <https://himalayas.app/terms#api>.
Code examples: <https://github.com/Himalayas-App/remote-jobs-api>.

Base URL: `https://himalayas.app`. User-Agent sent: `Mozilla/5.0 (compatible; himalayas-cli/1.0)`.

## Access, limits and terms

| Item | Value |
|------|-------|
| Authentication | None required. Optional free API key as `Authorization: Bearer <key>` (CLI reads `HIMALAYAS_API_TOKEN`). |
| Keyless rate limit | One shared public allowance for every keyless caller (number not published). Check-one-job endpoint: 60 req/min keyless. |
| Keyed rate limit | 60 req/min and 10,000 req/UTC day per account, shared across its keys. |
| Over limit | HTTP 429; with a key, `Retry-After` (seconds) and `X-RateLimit-*` headers. |
| Cache | Responses served from Himalayas' cache are free (search: `s-maxage=3600`). Data refreshes daily. |
| Invalid key | HTTP 401. |
| CORS | None (server-side use only). |
| robots.txt | `Allow: /`; disallows `/apply`, `/jobs?page=`, `/jobs*&page=`, `/jobs/*?page=` (HTML pages). The JSON API paths are not disallowed; this CLI uses only them. |
| Terms | Clause 30A: public API use within published docs/limits is allowed, as is a "Personal Agent" acting for one person (truthful, no bypassing limits, no bulk collection/republishing). Clause 113 (API users): use `applicationLink` for Apply unchanged; credit Himalayas with a visible link; show jobs only on your own sites/apps, never pass them to other boards/aggregators/Google Jobs/LinkedIn Jobs; cache, stay within limits, remove expired jobs; keep keys private. |

## `GET /jobs/api/search` (used by `search`)

| Param | CLI flag | Notes |
|-------|----------|-------|
| `q` | `--query`/`-q` | Free text. |
| `country` | `--country`/`-c` | ISO alpha-2, common names, slugs or abbreviations. Includes worldwide jobs unless `exclude_worldwide=true`. |
| `worldwide` | `--worldwide` | boolean; only worldwide-friendly jobs. |
| `exclude_worldwide` | `--exclude-worldwide` | boolean; with `country`, drop worldwide matches. |
| `seniority` | `--seniority` | Comma list: `Entry-level, Mid-level, Senior, Manager, Director, Executive`. |
| `employment_type` | `--employment-type` | Comma list: `Full Time, Part Time, Contractor, Temporary, Intern, Volunteer, Other`. |
| `company` | `--company` | Canonical company slug(s), comma-separated. |
| `timezone` | `--timezone` | `-5`, `UTC-5`, `UTC+05:30`. |
| `sort` | `--sort` | `relevant` (default), `recent`, `salaryAsc`, `salaryDesc`, `nameAToZ`, `nameZToA`, `jobs`. |
| `page` | `--page` | 1-based. Fixed 20 jobs per page; no `limit` param, no cursor. |
| (none) | `--jobage` | **Client-side** on `pubDate`; CLI defaults `sort=recent` when set. |
| (none) | `--limit` | **Client-side** slice of the page. |

Response:

```json
{ "comments": "...", "updatedAt": 1793539125, "offset": 0, "limit": 20,
  "totalCount": 202, "jobs": [ <job>, ... ] }
```

`totalCount` is an estimate, up to a day old. A page can hold fewer than 20 jobs before
the end; keep paging until a page has no jobs, and dedupe on `guid` (results can shift).

Errors: HTTP 400 with `{ "ok": false, "errors": "Invalid sort" }` (surfaced as `BAD_ARG`).

## `GET /jobs/api/companies/{company}/jobs/{slug}` (used by `detail`)

`{company}/{slug}` come from the job's `guid` path (`/companies/<company>/jobs/<slug>`),
which is the CLI's `id`.

| Status | Meaning |
|--------|---------|
| 200 | Open. Body `{ "job": <job> }` (same shape as search). |
| 410 | Closed. Body includes `expiryDate`. CLI: `JOB_CLOSED`. |
| 404 | No such job in the API. CLI: `NOT_FOUND`. |

Cached up to 10 minutes.

## `GET /jobs/api` (not used)

The full unfiltered feed: `limit` (max 20), `cursor` (pass back `nextCursor`), `offset`
(deprecated). Himalayas recommends walking it and filtering locally to collect *every* job
for a country; this skill does targeted searches instead to keep volume low.

## Job object -> CLI result

| API field | CLI field | Notes |
|-----------|-----------|-------|
| `guid` | `url`, `id` | `id` = `<company>/<slug>` from the guid path |
| `title` | `title` | HTML entities decoded |
| `companyName` / `companySlug` | `company` / `company_slug` | name can be entity-encoded (`H&amp;H Group`) |
| `locationRestrictions` (optional array of English country names) | `eligible_countries`, `worldwide`, `location` | empty/absent = worldwide |
| `timezoneRestrictions` (array of UTC offsets; all offsets if unrestricted) | `timezones` | |
| `pubDate` (Unix seconds, **last updated**) | `date` (`YYYY-MM-DD`, UTC) | |
| `expiryDate` (Unix seconds) | `expiry_date` | jobs can close earlier |
| `employmentType` | `employment_type` | |
| `seniority` (array) | `seniority` | |
| `minSalary`, `maxSalary`, `currency`, `salaryPeriod` | `salary`, `salary_min`, `salary_max`, `salary_currency`, `salary_period` | `salaryPeriod`: hourly, weekly, fortnightly, monthly, annual (default) |
| `categories`, `parentCategories` | `categories` | |
| `excerpt` | `excerpt` | |
| `description` (full HTML) | `description` (detail only) | tags stripped, `<li>` -> `- ` bullets |
| `applicationLink` | `apply_url` | must be used unchanged for applying (terms 113a) |
| `companyLogo` | (dropped) | |

## Eligibility rule (from the docs)

"A job is open to a country when `locationRestrictions` is empty or includes that country,
and `timezoneRestrictions` includes one of the country's standard (non-daylight-saving)
UTC offsets." The `country` param applies the first half server-side.
