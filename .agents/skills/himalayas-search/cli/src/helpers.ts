// Data source: the Himalayas public Remote Jobs API (JSON). Documented at
// https://himalayas.app/api (OpenAPI 3.1 at /docs/openapi.json). No key is
// required; an optional free key (HIMALAYAS_API_TOKEN) raises the rate limit.
// There is no markup to parse: we fetch JSON and reshape it into the
// portal-skill contract's result fields.
//
// robots.txt disallows `?page=` on the HTML listing pages (/jobs?page=...) and
// /apply. This CLI never touches HTML pages - only the /jobs/api/* JSON paths.

export const BASE_URL = "https://himalayas.app"

// Honest UA naming the tool - the convention every shipped portal CLI follows.
export const UA = "Mozilla/5.0 (compatible; himalayas-cli/1.0)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

/** An HTTP failure carrying the status, so callers can map 410 etc. */
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message)
  }
}

// The most apiGet sleeps across all retries of one request. A Retry-After that
// would push past it fails the request at once instead of hanging the caller.
const RETRY_BUDGET_MS = 30_000

/**
 * The wait a 429/503 asks for via `Retry-After`, in ms, or null when absent or
 * unreadable. Accepts both RFC 9110 forms: delta-seconds and an HTTP-date.
 */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(date - now, 0)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Request headers: honest UA, JSON, and the optional API key from the environment only. */
function headers(): Record<string, string> {
  const h: Record<string, string> = { "User-Agent": UA, Accept: "application/json" }
  const token = (process.env.HIMALAYAS_API_TOKEN ?? "").trim()
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

/** The API's error message from a `{ ok:false, errors }` body, if any. */
function apiErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null
  const errs = (body as { errors?: unknown; error?: unknown }).errors ?? (body as { error?: unknown }).error
  if (typeof errs === "string") return errs
  if (Array.isArray(errs)) return errs.map(String).join("; ")
  return null
}

/**
 * GET JSON from the Himalayas API. Retries 429/5xx with exponential backoff and
 * jitter (500ms doubling to 8s, max 6 retries), honouring Retry-After within a
 * total budget. Returns null on a 404. Other non-2xx statuses throw HttpError
 * (e.g. 410 Gone for a closed job, 400 for a bad filter value).
 */
export async function apiGet<T>(path: string): Promise<T | null> {
  const url = `${BASE_URL}${path}`
  const maxRetries = 6
  let delay = 500
  let waited = 0

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, { headers: headers(), redirect: "follow", signal: AbortSignal.timeout(20000) })
    } catch (e) {
      throw new Error(`could not reach the Himalayas API (${e instanceof Error ? e.message : String(e)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new HttpError(`Himalayas API request failed: ${response.status} ${response.statusText}`, response.status, null)
      }
      const backoff = delay + Math.floor(Math.random() * 500)
      const retryAfter = retryAfterMs(response.headers.get("Retry-After"))
      const wait = Math.max(backoff, retryAfter ?? 0)
      if (waited + wait > RETRY_BUDGET_MS) {
        throw new HttpError(
          `Himalayas API request failed: ${response.status} ${response.statusText}; ` +
            `the server asked to retry in ${Math.ceil(wait / 1000)}s, past this CLI's ${RETRY_BUDGET_MS / 1000}s retry budget` +
            (response.status === 429 ? " (the keyless allowance is shared by all callers; set HIMALAYAS_API_TOKEN for your own)" : ""),
          response.status,
          null,
        )
      }
      await sleep(wait)
      waited += wait
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null

    const body = (await response.json().catch(() => null)) as unknown
    if (!response.ok) {
      throw new HttpError(
        apiErrorMessage(body) || `Himalayas API request failed: ${response.status} ${response.statusText}`,
        response.status,
        body,
      )
    }
    if (body === null) throw new Error("Himalayas API returned an unparseable response body")
    return body as T
  }
  throw new Error("Himalayas API request failed after retries")
}

/** A Himalayas job object as the browse/search/check endpoints return it. */
export interface HimalayasJob {
  title: string
  excerpt?: string | null
  companyName?: string | null
  companySlug?: string | null
  companyLogo?: string | null
  employmentType?: string | null
  minSalary?: number | null
  maxSalary?: number | null
  salaryPeriod?: string | null
  seniority?: string[] | null
  currency?: string | null
  locationRestrictions?: string[] | null
  timezoneRestrictions?: number[] | null
  categories?: string[] | null
  parentCategories?: string[] | null
  description?: string | null
  pubDate?: number | null
  expiryDate?: number | null
  applicationLink?: string | null
  guid: string
}

export interface SearchResponse {
  comments?: string
  updatedAt?: number
  offset?: number
  limit?: number
  totalCount?: number
  jobs: HimalayasJob[]
}

/**
 * A search result in the portal-skill contract shape. `id` is `<company>/<slug>`
 * from the job's guid (what `detail` consumes); `date` is `pubDate` as
 * `YYYY-MM-DD`. Missing values are `null`, never omitted.
 */
export interface JobResult {
  id: string
  title: string
  company: string | null
  company_slug: string | null
  location: string
  date: string | null
  url: string
  apply_url: string | null
  eligible_countries: string[]
  worldwide: boolean
  timezones: number[]
  employment_type: string | null
  seniority: string[]
  salary: string | null
  salary_min: number | null
  salary_max: number | null
  salary_currency: string | null
  salary_period: string | null
  categories: string[]
  expiry_date: string | null
  excerpt: string | null
}

export interface JobDetailResult extends JobResult {
  description: string | null
}

/** Unix seconds -> `YYYY-MM-DD` (UTC), or null. */
export function unixToDate(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

const LOCATION_LIST_MAX = 4

/**
 * A readable location string. Himalayas jobs are all remote; an empty
 * locationRestrictions means the job is open worldwide (subject to timezone).
 */
export function formatLocation(countries: string[]): string {
  if (countries.length === 0) return "Remote (Worldwide)"
  if (countries.length <= LOCATION_LIST_MAX) return `Remote (${countries.join(", ")})`
  return `Remote (${countries.slice(0, LOCATION_LIST_MAX).join(", ")} +${countries.length - LOCATION_LIST_MAX} more)`
}

/** Human-readable salary: "CAD 90000-120000/annual", or null when no figure. */
export function formatSalary(j: HimalayasJob): string | null {
  const min = j.minSalary ?? null
  const max = j.maxSalary ?? null
  if (min == null && max == null) return null
  const cur = j.currency ? `${j.currency} ` : ""
  const per = `/${j.salaryPeriod || "annual"}`
  if (min != null && max != null) return min === max ? `${cur}${min}${per}` : `${cur}${min}-${max}${per}`
  return `${cur}${min ?? max}${per}`
}

const GUID_RE = /^\/companies\/([^/?#]+)\/jobs\/([^/?#]+)\/?$/

/** `<company>/<slug>` from a job guid URL, or null when it is not one. */
export function idFromGuid(guid: string): string | null {
  try {
    const u = new URL(guid)
    const m = GUID_RE.exec(u.pathname)
    return m ? `${m[1]}/${m[2]}` : null
  } catch {
    return null
  }
}

export function toResult(j: HimalayasJob): JobResult {
  const countries = (j.locationRestrictions ?? []).map((c) => decodeHtmlEntities(c))
  const guid = j.guid
  return {
    id: idFromGuid(guid) ?? guid,
    title: decodeHtmlEntities(j.title || "").trim() || "(untitled)",
    company: j.companyName ? decodeHtmlEntities(j.companyName).trim() : null,
    company_slug: j.companySlug || null,
    location: formatLocation(countries),
    date: unixToDate(j.pubDate),
    url: guid,
    apply_url: j.applicationLink || null,
    eligible_countries: countries,
    worldwide: countries.length === 0,
    timezones: j.timezoneRestrictions ?? [],
    employment_type: j.employmentType || null,
    seniority: j.seniority ?? [],
    salary: formatSalary(j),
    salary_min: j.minSalary ?? null,
    salary_max: j.maxSalary ?? null,
    salary_currency: j.currency || null,
    salary_period: j.minSalary != null || j.maxSalary != null ? j.salaryPeriod || "annual" : null,
    categories: j.categories ?? [],
    expiry_date: unixToDate(j.expiryDate),
    excerpt: j.excerpt ? decodeHtmlEntities(j.excerpt).trim() || null : null,
  }
}

export function toDetail(j: HimalayasJob): JobDetailResult {
  return { ...toResult(j), description: cleanHtml(j.description) }
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&rsquo;|&lsquo;/g, "'")
    .replace(/&rdquo;|&ldquo;/g, '"')
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "-")
    .replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
}

/**
 * Strip a job description's HTML into readable prose: list items become
 * "- " bullets, block/line-break tags become newlines, entities are decoded,
 * remaining tags removed. Null for empty input.
 */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|li|ul|ol|div|h\d|tr|blockquote)>/gi, "\n")
    .replace(/<(p|div|h\d|ul|ol)(\s[^>]*)?>/gi, "\n")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    // A <li><p>..</p></li> leaves the bullet marker on its own line and blank
    // lines between items: join the marker to its text, then single-space the list.
    .replace(/^- *\n+/gm, "- ")
    .replace(/^(- .*)\n{2,}(?=- )/gm, "$1\n")
    .trim()
  return text || null
}

const HIMALAYAS_HOST = /(^|\.)himalayas\.app$/i
const SLUG = /^[a-z0-9][a-z0-9._~%-]*$/i

/**
 * Parse `detail`'s argument into `{company, slug}`. Accepts a `<company>/<slug>`
 * id (from a search result) or a himalayas.app job URL (guid or apply link,
 * query string ignored). URLs on any other host are rejected.
 */
export function parseJobRef(input: string): { company: string; slug: string } | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}\//i.test(trimmed)) {
    let u: URL
    try {
      u = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!HIMALAYAS_HOST.test(u.hostname)) return null
    const path = u.pathname.replace(/^\/jobs\/api(?=\/companies\/)/, "")
    const m = GUID_RE.exec(path)
    return m ? { company: m[1], slug: m[2] } : null
  }
  const parts = trimmed.split("/")
  if (parts.length === 2 && SLUG.test(parts[0]) && SLUG.test(parts[1])) return { company: parts[0], slug: parts[1] }
  return null
}
