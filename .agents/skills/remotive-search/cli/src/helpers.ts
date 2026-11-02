// Data source: Remotive's official public API (https://remotive.com/api/remote-jobs),
// documented in the remotive-com/remote-jobs-api repo (see url-reference.md). JSON in, so there
// is no markup to parse beyond stripping each posting's HTML description.
//
// Terms (from the docs and the response's own "0-legal-notice"): link back to the
// Remotive URL and name Remotive as the source; listings are delayed 24 hours; call
// it "a couple of times a day (max. 4)"; excessive requests (> 2 per minute) are
// blocked. This CLI therefore makes ONE request per command and caches responses
// on disk (default 6 h), and everything else - paging, limit, age, country - is
// done client-side.

import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const DEFAULT_BASE_URL = "https://remotive.com"
export const API_PATH = "/api/remote-jobs"
export const SOURCE = "Remotive (https://remotive.com)"

/** API base URL: REMOTIVE_API_URL (tests point it at a local fixture server) or the default. */
export function baseUrl(): string {
  const raw = (process.env.REMOTIVE_API_URL ?? "").trim()
  return (raw || DEFAULT_BASE_URL).replace(/\/+$/, "")
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; remotive-cli/1.0)"

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

export interface RemotiveJob {
  id: number
  url: string
  title: string
  company_name: string
  company_logo?: string | null
  category: string
  tags?: string[]
  job_type?: string | null
  publication_date: string
  candidate_required_location?: string | null
  salary?: string | null
  description?: string | null
}

export interface RemotiveResponse {
  "job-count"?: number
  "total-job-count"?: number
  jobs: RemotiveJob[]
}

// ---------------------------------------------------------------------------
// Fetching: one request, disk cache, backoff with jitter on 429/5xx
// ---------------------------------------------------------------------------

/** Cache TTL in minutes. REMOTIVE_CACHE_TTL_MIN overrides; 0 disables the cache. */
export function cacheTtlMs(): number {
  const raw = (process.env.REMOTIVE_CACHE_TTL_MIN ?? "").trim()
  const min = raw === "" ? 360 : Number(raw)
  return Number.isFinite(min) && min > 0 ? min * 60_000 : 0
}

function cacheDir(): string {
  return (process.env.REMOTIVE_CACHE_DIR ?? "").trim() || join(tmpdir(), "remotive-cli-cache")
}

function cachePath(url: string): string {
  return join(cacheDir(), createHash("sha256").update(url).digest("hex").slice(0, 24) + ".json")
}

function readCache(url: string): RemotiveResponse | null {
  const ttl = cacheTtlMs()
  if (ttl <= 0) return null
  try {
    const entry = JSON.parse(readFileSync(cachePath(url), "utf8")) as { url: string; at: number; body: RemotiveResponse }
    if (entry.url !== url || Date.now() - entry.at > ttl || !Array.isArray(entry.body?.jobs)) return null
    return entry.body
  } catch {
    return null
  }
}

/**
 * A job by id from ANY fresh cached response (a prior search's included), so
 * `detail` on a hit `search` just returned costs no request at all.
 */
export function findCachedJob(id: string): RemotiveJob | null {
  const ttl = cacheTtlMs()
  if (ttl <= 0) return null
  let files: string[]
  try {
    files = readdirSync(cacheDir()).filter((f) => f.endsWith(".json"))
  } catch {
    return null
  }
  const prefix = `${baseUrl()}${API_PATH}`
  for (const f of files) {
    try {
      const entry = JSON.parse(readFileSync(join(cacheDir(), f), "utf8")) as { url: string; at: number; body: RemotiveResponse }
      if (!entry.url?.startsWith(prefix) || Date.now() - entry.at > ttl) continue
      const job = entry.body?.jobs?.find((j) => String(j.id) === id)
      if (job) return job
    } catch {
      // skip unreadable entries
    }
  }
  return null
}

function writeCache(url: string, body: RemotiveResponse): void {
  if (cacheTtlMs() <= 0) return
  try {
    mkdirSync(cacheDir(), { recursive: true })
    writeFileSync(cachePath(url), JSON.stringify({ url, at: Date.now(), body }))
  } catch {
    // A cache that cannot be written only costs a future request; never fail on it.
  }
}

// Remotive blocks more than ~2 requests a minute, so retries must be patient
// rather than rapid: 2 s doubling, Retry-After honored, 60 s total budget.
const RETRY_BUDGET_MS = 60_000
const MAX_RETRIES = 6

/** The wait a 429/503 asks for via `Retry-After`, in ms, or null when absent/unreadable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const value = header.trim()
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return null
  return Math.max(date - now, 0)
}

/**
 * GET the Remotive job list. Returns the cached body when fresh, `null` on 404,
 * and throws (with a clear message) on network failure or exhausted retries.
 */
export async function fetchJobs(params: URLSearchParams): Promise<RemotiveResponse | null> {
  const qs = params.toString()
  const url = `${baseUrl()}${API_PATH}${qs ? `?${qs}` : ""}`
  const cached = readCache(url)
  if (cached) return cached

  let delay = 2000
  let waited = 0
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json" },
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      })
    } catch (e) {
      throw new Error(`could not reach the Remotive API at ${baseUrl()} (${e instanceof Error ? e.message : String(e)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      const wait = Math.max(delay + Math.floor(Math.random() * 1000), retryAfterMs(response.headers.get("Retry-After")) ?? 0)
      if (attempt === MAX_RETRIES || waited + wait > RETRY_BUDGET_MS) {
        const hint = response.status === 429 ? " - Remotive blocks more than ~2 requests/minute; wait and retry later" : ""
        throw new Error(`Remotive API request failed: ${response.status} ${response.statusText}${hint}`)
      }
      await new Promise((r) => setTimeout(r, wait))
      waited += wait
      delay = Math.min(delay * 2, 16_000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Remotive API request failed: ${response.status} ${response.statusText}`)

    const body = (await response.json().catch(() => null)) as RemotiveResponse | null
    if (!body || !Array.isArray(body.jobs)) throw new Error("Remotive API returned an unparseable response body")
    writeCache(url, body)
    return body
  }
  throw new Error("Remotive API request failed after retries")
}

// ---------------------------------------------------------------------------
// Text cleaning
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", bull: "•",
  middot: "·", euro: "€", pound: "£", copy: "©",
  reg: "®", trade: "™", times: "×", eacute: "é",
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
}

/**
 * Strip a Remotive HTML description into readable text: block tags become
 * paragraph breaks, list items get a bullet, entities are decoded, whitespace
 * (including non-breaking spaces) collapsed. Null for empty input.
 */
export function cleanHtml(html: string | null | undefined): string | null {
  if (!html) return null
  // Source newlines are insignificant whitespace in HTML; only tags break lines.
  const withBreaks = html
    .replace(/\s+/g, " ")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|h[1-6]|ul|ol|blockquote|table|tr)>/gi, "\n\n")
    .replace(/<\/li>/gi, "")
  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ""))
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/^- *\n/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(- .*)\n\n(?=- )/gm, "$1\n") // <li><p>..</p></li> lists: no blank line between bullets
    .trim()
  return text || null
}

// ---------------------------------------------------------------------------
// Result shaping
// ---------------------------------------------------------------------------

export interface JobResult {
  id: string
  title: string
  company: string | null
  location: string | null
  eligible_regions: string[]
  date: string | null
  url: string
  category: string | null
  job_type: string | null
  salary: string | null
  tags: string[]
  description: string | null
}

export interface JobDetailResult extends JobResult {
  published_at: string | null
  company_logo: string | null
  source: string
}

/** `YYYY-MM-DD` from Remotive's `publication_date` (`2026-10-29T18:22:41`), or null. */
export function contractDate(value: string | null | undefined): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(value ?? "")
  return m ? m[1] : null
}

/** Split `candidate_required_location` ("USA, Canada, USA timezones") into its entries. */
export function splitRegions(loc: string | null | undefined): string[] {
  if (!loc) return []
  return loc
    .split(/\s*(?:,|;|\/|\||\bor\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Remotive's job_type slug as a label: "full_time" -> "full-time". Null when unset. */
function jobType(value: string | null | undefined): string | null {
  const v = (value ?? "").trim()
  return v ? v.replace(/_/g, "-") : null
}

export function toResult(j: RemotiveJob, includeDescription = true): JobResult {
  const loc = (j.candidate_required_location ?? "").trim() || null
  return {
    id: String(j.id),
    title: decodeHtmlEntities(j.title ?? "").trim() || "(untitled)",
    company: decodeHtmlEntities(j.company_name ?? "").trim() || null,
    location: loc,
    eligible_regions: splitRegions(loc),
    date: contractDate(j.publication_date),
    url: j.url,
    category: j.category || null,
    job_type: jobType(j.job_type),
    salary: (j.salary ?? "").trim() || null,
    tags: (j.tags ?? []).map((t) => t.trim()).filter(Boolean),
    description: includeDescription ? cleanHtml(j.description) : null,
  }
}

export function toDetail(j: RemotiveJob): JobDetailResult {
  return {
    ...toResult(j, true),
    published_at: j.publication_date || null,
    company_logo: j.company_logo || null,
    source: SOURCE,
  }
}

// ---------------------------------------------------------------------------
// Client-side filters
// ---------------------------------------------------------------------------

/**
 * Keyword match with the API's documented `search` semantics: a case-insensitive
 * partial ("ilike") match of the whole query against the title or description.
 * Applied client-side because the public endpoint currently ignores `search`.
 */
export function matchesQuery(j: RemotiveJob, query: string | undefined): boolean {
  const q = (query ?? "").trim().toLowerCase().replace(/\s+/g, " ")
  if (!q) return true
  const title = decodeHtmlEntities(j.title ?? "").toLowerCase().replace(/\s+/g, " ")
  if (title.includes(q)) return true
  const desc = (cleanHtml(j.description) ?? "").toLowerCase().replace(/\s+/g, " ")
  return desc.includes(q)
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}

// Remotive category slugs whose slug is not a prefix of the slugified name
// (from /api/remote-jobs/categories).
const CATEGORY_SLUGS: Record<string, string> = {
  product: "product-management",
  data: "data-and-analytics",
  qa: "quality-assurance",
  education: "teaching",
  "travel-hospitality": "travel-and-hospitality",
}

/** Category match: the category's name or slug (case-insensitive). */
export function matchesCategory(j: RemotiveJob, category: string | undefined): boolean {
  if (!category) return true
  const want = slugify(category)
  const have = slugify(j.category ?? "")
  return have === want || have === CATEGORY_SLUGS[want]
}

/** Company match with the API's `company_name` semantics: case-insensitive partial match. */
export function matchesCompany(j: RemotiveJob, company: string | undefined): boolean {
  if (!company) return true
  return (j.company_name ?? "").toLowerCase().includes(company.trim().toLowerCase())
}

/** Posted within the last `days` days (by publication_date, read as UTC). */
export function withinDays(j: RemotiveJob, days: number | undefined, now = Date.now()): boolean {
  if (!days) return true
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(j.publication_date) ? j.publication_date : `${j.publication_date}Z`)
  if (Number.isNaN(t)) return false
  return now - t <= days * 86_400_000
}

// ---------------------------------------------------------------------------
// Country eligibility (--country)
// ---------------------------------------------------------------------------

/** Terms that make a posting open to any country. */
export const WORLDWIDE_TERMS = ["worldwide", "anywhere", "global", "globally", "international"]

const AMERICAS = ["americas", "the americas"]
const NORTH_AMERICA = ["north america", ...AMERICAS]
const LATAM = ["latam", "latin america", "south america", ...AMERICAS]
const EUROPE = ["europe", "eu", "eea", "emea", "european union"]
const APAC = ["apac", "asia pacific", "asia-pacific", "asia"]
const OCEANIA = ["oceania", "apac", "asia pacific", "asia-pacific", "anz"]

interface CountryInfo {
  aliases: string[]
  regions: string[]
}

// Known countries: aliases (names a posting may use) and the regions that
// include them. Unknown countries fall back to their own name + worldwide terms.
const COUNTRIES: Record<string, CountryInfo> = {
  canada: { aliases: ["canada"], regions: NORTH_AMERICA },
  "united states": { aliases: ["united states", "usa", "us", "u.s.", "u.s.a.", "united states of america"], regions: NORTH_AMERICA },
  mexico: { aliases: ["mexico"], regions: [...NORTH_AMERICA, ...LATAM] },
  brazil: { aliases: ["brazil", "brasil"], regions: LATAM },
  argentina: { aliases: ["argentina"], regions: LATAM },
  colombia: { aliases: ["colombia"], regions: LATAM },
  chile: { aliases: ["chile"], regions: LATAM },
  "united kingdom": { aliases: ["united kingdom", "uk", "u.k.", "great britain", "britain", "england", "scotland", "wales"], regions: ["europe", "emea"] },
  ireland: { aliases: ["ireland"], regions: EUROPE },
  germany: { aliases: ["germany", "deutschland"], regions: EUROPE },
  france: { aliases: ["france"], regions: EUROPE },
  spain: { aliases: ["spain"], regions: EUROPE },
  portugal: { aliases: ["portugal"], regions: EUROPE },
  italy: { aliases: ["italy"], regions: EUROPE },
  netherlands: { aliases: ["netherlands", "the netherlands", "holland"], regions: EUROPE },
  poland: { aliases: ["poland"], regions: EUROPE },
  sweden: { aliases: ["sweden"], regions: [...EUROPE, "nordics", "scandinavia"] },
  denmark: { aliases: ["denmark"], regions: [...EUROPE, "nordics", "scandinavia"] },
  norway: { aliases: ["norway"], regions: ["europe", "eea", "emea", "nordics", "scandinavia"] },
  india: { aliases: ["india"], regions: APAC },
  philippines: { aliases: ["philippines"], regions: APAC },
  singapore: { aliases: ["singapore"], regions: APAC },
  japan: { aliases: ["japan"], regions: APAC },
  australia: { aliases: ["australia"], regions: OCEANIA },
  "new zealand": { aliases: ["new zealand"], regions: OCEANIA },
}

const COUNTRY_ALIASES: Record<string, string> = {
  ca: "canada",
  us: "united states", usa: "united states", "u.s.": "united states", america: "united states",
  uk: "united kingdom", gb: "united kingdom", "great britain": "united kingdom", england: "united kingdom",
  de: "germany", fr: "france", es: "spain", nl: "netherlands", "the netherlands": "netherlands",
  au: "australia", nz: "new zealand", in: "india", br: "brazil", mx: "mexico",
}

export interface CountryRule {
  country: string
  aliases: string[]
  regions: string[]
}

/** Resolve a --country value (name or common code) into the terms that make a job eligible. */
export function countryRule(input: string): CountryRule {
  const key = input.trim().toLowerCase().replace(/\s+/g, " ")
  const name = COUNTRY_ALIASES[key] ?? key
  const info = COUNTRIES[name]
  return info ? { country: name, aliases: info.aliases, regions: info.regions } : { country: name, aliases: [name], regions: [] }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function hasTerm(text: string, terms: string[]): boolean {
  return terms.some((t) => new RegExp(`(^|[^a-z0-9])${escapeRe(t)}(?=$|[^a-z0-9])`, "i").test(text))
}

const EXCLUSION = /\b(except|excluding|excl\.?|exclude|not in|outside( of)?)\b/i

/**
 * True when a job's `candidate_required_location` admits a candidate in the
 * rule's country: the location names the country (or an alias), a region that
 * contains it, or a worldwide term - and the country is not named after an
 * exclusion word ("Worldwide except Canada"). An empty location is treated as
 * NOT eligible (unknown restriction - kept out rather than guessed in).
 */
export function isEligible(location: string | null | undefined, rule: CountryRule): boolean {
  const loc = (location ?? "").trim()
  if (!loc) return false
  const ex = EXCLUSION.exec(loc)
  const included = ex ? loc.slice(0, ex.index) : loc
  const excluded = ex ? loc.slice(ex.index + ex[0].length) : ""
  if (excluded && hasTerm(excluded, [...rule.aliases, ...rule.regions])) return false
  return hasTerm(included, [...rule.aliases, ...rule.regions, ...WORLDWIDE_TERMS])
}

// ---------------------------------------------------------------------------
// detail <id|url>
// ---------------------------------------------------------------------------

/**
 * A Remotive job id from a bare numeric id or a remotive.com job URL
 * (`https://remotive.com/remote-jobs/<category>/<slug>-<id>`). Null otherwise.
 */
export function parseJobId(input: string): string | null {
  const s = input.trim()
  if (/^\d+$/.test(s)) return s
  let u: URL
  try {
    u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
  } catch {
    return null
  }
  if (!/(^|\.)remotive\.(com|io)$/i.test(u.hostname)) return null
  const m = /-(\d+)\/?$/.exec(u.pathname) ?? /\/(\d+)\/?$/.exec(u.pathname)
  return m ? m[1] : null
}
