# We Work Remotely — URL & markup reference

Recon date: 2026-11-01. All endpoints are public, no authentication. User-Agent sent:
`Mozilla/5.0 (compatible; weworkremotely-cli/1.0)` (served normally, no bot wall).

## robots.txt

`https://weworkremotely.com/robots.txt` — `User-agent: *`, `Allow: /`; disallows only
`/admin/`, `/account/`, `/job-seekers/account/`, `/job-seekers/profile/`, `/manage-company/`,
`/*edit?token=/`, `/*cancel?token=/`. Search, category and job pages are allowed.

## Endpoints used

| Purpose | URL | Notes |
|---------|-----|-------|
| Keyword search | `https://weworkremotely.com/remote-jobs/search?term=<q>` | Server-rendered HTML. Returns **all** matching active jobs on one page (no pagination). Match is a case-insensitive **substring** of title/company (`EDI` matches "Media"). |
| Category listing | `https://weworkremotely.com/categories/<slug>` | All active jobs in the category (e.g. 33 for DevOps on 2026-11-01). Same card markup. |
| Job detail | `https://weworkremotely.com/remote-jobs/<slug>` | HTML with a JSON-LD `JobPosting` block plus an "About the job" sidebar. Unknown slug → 404. |

### Endpoints evaluated and not used

| URL | Why not |
|-----|---------|
| `https://weworkremotely.com/remote-jobs.rss` | Valid RSS 2.0 (~1 MB) but only the newest 100 jobs, 10 per category. Items carry `<title>Company: Role</title>`, `<region>`, `<country>`, `<state>`, `<skills>`, `<category>`, `<type>`, `<description>` (escaped HTML), `<pubDate>`, `<expires_at>`, `<guid>`/`<link>` = job URL. Fine for "newest jobs", poor recall for keyword search. |
| `https://weworkremotely.com/categories/<slug>.rss` | Per-category RSS, same item shape. |
| `https://weworkremotely.com/remote-jobs/search.rss?term=<q>` | HTTP 406 — no keyword RSS. |
| `https://weworkremotely.com/remote-jobs/search?term=` (empty) | Returns the homepage-style grouped view, truncated per category; not a full listing. |

## Search parameters

| CLI flag | Portal parameter | Where applied |
|----------|------------------|---------------|
| `--query` | `term` | server |
| `--category` | path `/categories/<slug>` (no query) or card `data-category` id (with query) | server / client |
| `--eligible` | — (region pills) | client |
| `--exact` | — | client (whole-word match on title + company) |
| `--jobage` | — (card relative age) | client |
| `--page`, `--limit` | — | client (25 per page) |

The search page has a JS-driven filter UI (`country[]`, `salary_range[]`, `skills[]`,
category checkboxes, `sort`, `job_filter=all|hot|boosted`); the CLI does not depend on it.

### Category key → slug → `data-category` id

| Key | Slug | id |
|-----|------|----|
| full-stack-programming | remote-full-stack-programming-jobs | 2 |
| front-end-programming | remote-front-end-programming-jobs | 17 |
| back-end-programming | remote-back-end-programming-jobs | 18 |
| devops-sysadmin | remote-devops-sysadmin-jobs | 6 |
| design | remote-design-jobs | 1 |
| product | remote-product-jobs | 11 |
| customer-support | remote-customer-support-jobs | 7 |
| sales-and-marketing | remote-sales-and-marketing-jobs | 9 |
| management-and-finance | remote-management-and-finance-jobs | 3 |
| all-other | all-other-remote-jobs | 4 |

(ids from `<section class="jobs" id="category-N">` and card `data-category="N"`; design
sub-categories Product Design = 19 and UX/UI = 20 exist in the filter UI but are not mapped.)

## Listing card markup (search + category pages)

Split on `<li`, take each chunk up to its `</li>`, parse independently:

```html
<li class=" new-listing-container feature " data-category="2">
  <a class="listing-link--unlocked" href="/remote-jobs/<slug>">
    <h3 class="new-listing__header__title"><span class="new-listing__header__title__text">TITLE</span></h3>
    <p class="new-listing__header__icons__date"> 4d </p>          <!-- or <span class="new">New</span> -->
    <p class="new-listing__company-name"> COMPANY <img .../></p>
    <p class="new-listing__company-headquarters"><span ...> HQ:</span> Brooklyn, NY </p>
    <div class="new-listing__categories">
      <p class="new-listing__categories__category new-listing__categories__category--boosted">Boosted</p>
      <p class="new-listing__categories__category new-listing__categories__category--top-company"> Top 100 </p>
      <p class="new-listing__categories__category"> Full-Time </p>               <!-- job type -->
      <p class="new-listing__categories__category"> $100,000 or more USD </p>    <!-- optional salary -->
      <p class="new-listing__categories__category"> Anywhere in the World </p>   <!-- region pill(s) -->
    </div>
  </a>
</li>
```

- **id** = `<slug>` from `href="/remote-jobs/<slug>"`.
- **Region pills**: everything in `new-listing__categories` that is not a badge (Boosted / Top 100 /
  Featured / New / Promoted), the first job-type pill (Full-Time, Contract, Part-Time, ...), or a
  salary pill. Values seen on 2026-11-01: `Anywhere in the World`, `USA Only`,
  `North America Only`, `Canada Only` (RSS `<region>` values), or one pill per country with a
  flag emoji (`🇲🇽 Mexico`) — the flag is stripped. The site also has Europe / Latin America
  region pages, so `Europe Only`-style group pills are handled by `--eligible` too.
  Joined with `, ` into `region`.
- **Age**: `New` (≈ last 2 days; a job posted 1.9 days earlier still showed New) or `<n>d`.
- **Ads**: `<li id="listing-ad-N" class="feature feature--ad new-listing-container listing-ad ...">`
  linking to `/listing_ads/N/click...` — skipped.

## Detail page markup

- **JSON-LD** `<script type="application/ld+json">` with `"@type" : "JobPosting"`. Not valid
  JSON (the `description` string contains raw newlines), so fields are read by regex:
  `title`, `description` (HTML-escaped HTML), `datePosted` (`"2026-10-29 07:30:52 UTC"`),
  `validThrough`, `employmentType`, `occupationalCategory`, `jobLocation.address.addressLocality`,
  `applicantLocationRequirements` (array of `{"@type":"Country","name":"MX"}` ISO codes — ~249
  for "Anywhere in the World"), `hiringOrganization.name` / `.address` (HQ), `baseSalary`
  (`minValue`/`maxValue` "0" when not given).
- **Title**: `<h1 class="lis-container__header__hero__company-info__title">`.
- **Description**: `<div class="lis-container__job__content__description">` (depth-tracked div
  extraction), JSON-LD `description` as fallback.
- **Sidebar** `<ul class="lis-container__job__sidebar__job-about__list">` items: `Posted on`,
  `Apply before`, `Job type`, `Category`, and `Region` (e.g. `Anywhere in the World`) **or**
  `Country` (geo-locked jobs, e.g. `🇲🇽 Mexico`) with `<span class="box ...">` values.
- **Apply**: `apply-btn--locked` → `/job-seekers/account/register` (account required); no
  apply URL is exposed publicly.
