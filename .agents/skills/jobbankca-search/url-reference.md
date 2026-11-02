# Job Bank Canada — URL & Markup Reference

Recon performed 2026-11-01 against the live site. Everything below was observed in real
responses; update this file when Job Bank changes its markup.

## Access

- `https://www.jobbank.gc.ca/robots.txt`: `User-agent: *`, `Crawl-delay: 5`, nothing disallowed.
- No login needed for search or posting pages (sign-in is only for favourites / Direct Apply).
- The honest UA `Mozilla/5.0 (compatible; jobbankca-cli/1.0)` is served normally (HTTP 200).
- Responses set a `jsessionid`; the CLI does not need it (all parameters are stateless).

## Search

```
GET https://www.jobbank.gc.ca/jobsearch/jobsearch?searchstring=<kw>&sort=D&page=<n>[&filters]
```

Server-rendered HTML, 25 results per page. Job Bank rewrites `searchstring` into NOC
occupation facets (`term=`, `fcid=`, `fn21=`) internally — you do not need to send those.

| Parameter | Values | Notes |
|-----------|--------|-------|
| `searchstring` | free text | Keywords; matched to NOC 2021 occupations + job-title concordance |
| `sort` | `D` (date, newest first); the page also links `M` (other sort order, meaning not verified) | CLI always sends `D` |
| `page` | 1, 2, ... | Stateless: `page=2` returns the next 25 (verified distinct IDs) |
| `fskl` | `15141` | Work location = **Remote** |
| `fskl` | `100000` | Work location = **Hybrid** |
| `fskl` | `¬15141`, `¬100000`, `¬100001`, `¬100006` (URL-encoded `%C2%AC…`, all four) | **On site** — exactly what the site's own "On site" checkbox sends |
| `fskl` | `¬15141` | "Exclude remote jobs" (not exposed by the CLI) |
| `fskl` | `100001` / `100006` | "On the road job" / "Frequent or cyclical relocation" (not exposed) |
| `fage` | `2`, `30`, `+30` | Date posted: last 48 h / last 30 days / more than 30 days |
| `fprov` | `AB BC MB NB NL NS NT NU ON PE QC SK YT` | Province/territory facet (repeatable) |
| `locationstring` + `locationparam` | `Toronto, ON` + `22437` | City search (~50 km, `d=50` default). **`locationstring` alone is silently ignored** — it must be paired with the numeric `city_id` |
| `fsrc` | `16` = Job Bank-direct, `¬16` = partner postings | Job source facet (not exposed) |

Source of these values: the filter checkboxes on the results page (`#remotework-type`,
`#dateposted-type`, `#province-type`), whose `data-url` attributes hold the exact query
strings.

### City lookup (for `--location <city>`)

```
GET https://www.jobbank.gc.ca/core/ta-cityprovsuggest_en/select?q=<city>&fq=NOT postalcode_cnt:0&wt=json&rows=25
```

Solr JSON used by the site's own location autocomplete. `response.docs[]` items have
`name`, `city_id` (→ `locationparam`), `province_cd`, `doctype` (`C` = city).

### Result card anchors

Each result is `<article id="article-<postingId>" class="action-buttons">…</article>`; the
parser splits on `<article id="article-` and parses each chunk independently.

| Field | Anchor |
|-------|--------|
| id | `article-(\d+)` |
| title | `<span class="noctitle">…</span>` |
| date | `<li class="date">November 01, 2026</li>` → ISO |
| company | `<li class="business">…</li>` |
| location | `<li class="location">` (drop `<span class="wb-inv">Location</span>`) — `Regina (SK)` or `Toronto, ON` |
| salary | `<li class="salary">` (drop leading "Salary") |
| source / job number | `<li class="source">`: `<span class="wb-inv">SaskJobs</span>` + trailing number |
| workplace | `<span class="telework">Remote|Hybrid|On site</span>` inside `.flag` — **only on Job Bank-direct cards** |
| total hits | `<span class="found" id="results-count">273</span>` |

"Show more results" uses session-bound `/jobsearch/job_search_loader.xhtml`; the CLI uses
the stateless `page=` parameter instead.

## Posting detail

```
GET https://www.jobbank.gc.ca/jobsearch/jobposting/<id>
```

No JSON-LD. The page carries Schema.org **RDFa** (`vocab="http://schema.org/" typeof="JobPosting"`
on employer postings; partner postings have the same `property=` attributes with an empty `typeof`).

| Field | Anchor |
|-------|--------|
| title | `property="title"` |
| date posted | `property="datePosted"` → "Posted on October 14, 2026" |
| company | `property="hiringOrganization"` > `property="name"` (may wrap an `<a>` or `<strong>`) |
| location | `<ul class="job-posting-brief">` item labelled `<span class="wb-inv">Location</span>` — "Remote based in Toronto, ON" or RDFa `addressLocality`/`addressRegion` |
| workplace | item labelled `<span class="wb-inv">Work location</span>` → `<span>Remote|Hybrid|On site</span>`; fallback "Workplace information: Remote." in the hidden description |
| salary | `property="baseSalary"` (currency in a hidden span, `property="unitText"` HOUR/YEAR) |
| employment type | `property="employmentType"` ("Permanent employment" + "Full time") |
| vacancies / start | brief items "1 vacancy", "Starts as soon as possible" |
| source | brief item labelled `Source`: `<span>Job Bank</span><span>#3694978</span>` |
| apply / full posting | `#externalJobLink` (partner) or `.external-job a` "Learn more about this job" (employer) |
| deadline | `property="validThrough"` → `2026-11-04` |
| description (employer) | `<div class="main-job-posting-detail job-posting-detail-requirements">` up to `.job-posting-detail-apply` — h3/h4 headings over `ul.csvlist > span` items |
| description (partner) | `<span class="hidden" property="description">` — whitespace-collapsed summary of the partner text |

### Expired postings

A removed posting answers `302 → /jobsearch/jobpostingexpired;jsessionid=…`, which returns
**HTTP 410**. The CLI maps that to `isActive: false` (exit 0).
