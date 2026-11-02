// Data source: Dice's public web pages (https://www.dice.com). No authentication.
//
// Search: GET https://www.dice.com/jobs?q=...&filters.workplaceTypes=...&filters.postedDate=...&page=N
// The page is a Next.js App Router page; the search results are server-rendered
// into the React Server Components "flight" payload, i.e. a series of
//   <script>self.__next_f.push([1,"<JSON-escaped text>"])</script>
// tags. Concatenating the decoded strings yields text that contains
//   "jobList":{"data":[{...job...},{...job...}],"meta":{"currentPage":1,"pageSize":30,...}}
// which is the same JSON the internal job-search API returns. We read that
// embedded blob rather than calling the API (the API is only called server
// side; no key is exposed to the browser, and we do not need one).
//
// Detail: GET https://www.dice.com/job-detail/<uuid>
// Parsed from the schema.org JobPosting JSON-LD block
// (<script type="application/ld+json" id="jobDetailStructuredData">) plus the
// header-card badges (employment types, workplace, contract duration).
//
// Personal use only: dice.com's robots.txt disallows /jobs?q*, /job (which
// covers /job-detail/), /jobsearch/, /rss/ and /feed/. Keep volume low.

export const BASE_URL = "https://www.dice.com"
export const SEARCH_URL = `${BASE_URL}/jobs`
export const DETAIL_URL = `${BASE_URL}/job-detail`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export const UA = "Mozilla/5.0 (compatible; dice-cli/1.0)"

/** Backoff schedule knobs (exported so tests can shrink them). */
export const RETRY = { maxRetries: 6, baseDelayMs: 500, maxDelayMs: 8000 }

/** Fetch HTML with exponential backoff + jitter on 429/5xx. Returns "" on a 404/410. */
export async function htmlFetch(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  let delay = RETRY.baseDelayMs
  for (let attempt = 0; attempt <= RETRY.maxRetries; attempt++) {
    const response = await fetchImpl(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === RETRY.maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * RETRY.baseDelayMs)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, RETRY.maxDelayMs)
      continue
    }
    if (response.status === 404 || response.status === 410) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", bull: "•",
  middot: "·", copy: "©", reg: "®", trade: "™",
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => NAMED_ENTITIES[name] ?? whole)
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/** HTML description -> readable text with paragraph / list breaks preserved. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/\r/g, "")
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|ul|ol|div|h\d|tr)>/gi, "\n")
    .replace(/<\/li>/gi, "")
    .replace(/<\s*(p|h\d|ul|ol|div|tr)[^>]*>/gi, "\n")
  return withBreaks
    .split("\n")
    .map((l) => {
      const bullet = l.trimStart().startsWith("- ")
      const t = clean(l.trimStart().replace(/^- /, ""))
      return bullet && t ? `- ${t}` : t
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ---------------------------------------------------------------------------
// Search parsing
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string // Dice job GUID (UUID) - the key /job-detail/<id> takes
  title: string
  company: string | null
  location: string | null
  date: string | null // ISO 8601 posted date
  url: string
  workplace: string[] | null // e.g. ["Remote"], ["Hybrid"], ["Remote","On-Site"]
  isRemote: boolean | null
  employmentType: string | null // e.g. "Full-time", "Contract, Third Party"
  employerType: string | null // e.g. "Direct Hire", "Recruiter"
  salary: string | null
  easyApply: boolean | null
  summary: string | null
  diceId: string | null // Dice's internal hex id (not used by detail)
}

export interface SearchMeta {
  currentPage: number | null
  pageSize: number | null
  pageCount: number | null
  totalResults: number | null
}

/**
 * Concatenate every `self.__next_f.push([1,"..."])` string in the page into
 * the decoded RSC flight text. Each pushed string is a JSON string literal.
 * A chunk that fails to decode is skipped rather than aborting the page.
 */
export function extractFlight(html: string): string {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g
  let out = ""
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      out += JSON.parse(m[1]) as string
    } catch {
      // skip a malformed chunk
    }
  }
  return out
}

/**
 * Starting at `start` (which must point at "[" or "{"), return the index just
 * past the matching close bracket, honoring JSON string literals. -1 if
 * unbalanced.
 */
function matchBracket(text: string, start: number): number {
  let depth = 0
  let inStr = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === "\\") i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === "[" || ch === "{") depth++
    else if (ch === "]" || ch === "}") {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/**
 * Split a JSON array's text into its top-level object texts, so each card is
 * JSON.parse'd independently and one malformed card cannot break the rest.
 */
export function splitTopLevelObjects(arrayText: string): string[] {
  const out: string[] = []
  let i = arrayText.indexOf("[") + 1
  while (i > 0 && i < arrayText.length) {
    const open = arrayText.indexOf("{", i)
    if (open === -1) break
    const end = matchBracket(arrayText, open)
    if (end === -1) break
    out.push(arrayText.slice(open, end))
    i = end
  }
  return out
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null
}
function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Map one raw Dice job object to a JobCard, or null if it lacks the essentials. */
export function toJobCard(raw: Record<string, unknown>): JobCard | null {
  const detailsUrl = str(raw.detailsPageUrl)
  let guid = str(raw.guid)
  if (!guid && detailsUrl) guid = detailsUrl.match(/\/job-detail\/([0-9a-f-]{36})/i)?.[1] ?? null
  const title = str(raw.title)
  if (!guid || !UUID_RE.test(guid) || !title) return null

  const loc = raw.jobLocation as Record<string, unknown> | undefined
  const location = loc && typeof loc === "object" ? str(loc.displayName) : null
  const wt = Array.isArray(raw.workplaceTypes)
    ? (raw.workplaceTypes as unknown[]).filter((x): x is string => typeof x === "string")
    : null

  return {
    id: guid.toLowerCase(),
    title: clean(title),
    company: str(raw.companyName),
    location,
    date: str(raw.postedDate),
    url: detailsUrl ?? `${DETAIL_URL}/${guid}`,
    workplace: wt && wt.length ? wt : null,
    isRemote: bool(raw.isRemote),
    employmentType: str(raw.employmentType),
    employerType: str(raw.employerType),
    salary: str(raw.salary),
    easyApply: bool(raw.easyApply),
    summary: str(raw.summary) ? clean(raw.summary as string) : null,
    diceId: str(raw.id),
  }
}

export interface ParsedSearch {
  found: boolean // false = no jobList blob at all (markup drift / blocked page)
  cards: JobCard[]
  meta: SearchMeta
}

/** Parse a search-results page (raw HTML, or already-decoded flight text). */
export function parseSearchPage(html: string): ParsedSearch {
  const flight = html.includes("self.__next_f.push") ? extractFlight(html) : html
  const meta: SearchMeta = { currentPage: null, pageSize: null, pageCount: null, totalResults: null }
  const key = '"jobList":{"data":'
  const at = flight.indexOf(key)
  if (at === -1) return { found: false, cards: [], meta }

  const arrStart = at + key.length
  const arrEnd = matchBracket(flight, arrStart)
  if (arrEnd === -1) return { found: false, cards: [], meta }

  const cards: JobCard[] = []
  const seen = new Set<string>()
  for (const objText of splitTopLevelObjects(flight.slice(arrStart, arrEnd))) {
    try {
      const card = toJobCard(JSON.parse(objText))
      if (card && !seen.has(card.id)) {
        seen.add(card.id)
        cards.push(card)
      }
    } catch {
      // one malformed card must not break the rest
    }
  }

  // "meta" follows the data array inside jobList.
  const tail = flight.slice(arrEnd, arrEnd + 20000)
  meta.currentPage = num(Number(tail.match(/"currentPage":(\d+)/)?.[1] ?? NaN))
  meta.pageSize = num(Number(tail.match(/"pageSize":(\d+)/)?.[1] ?? NaN))
  meta.pageCount = num(Number(tail.match(/"pageCount":(\d+)/)?.[1] ?? NaN))
  meta.totalResults = num(Number(tail.match(/"totalResults":(\d+)/)?.[1] ?? NaN))
  return { found: true, cards, meta }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

/** --remote mode -> Dice filters.workplaceTypes value. */
export function workplaceFilter(mode: string | undefined): string | null {
  switch ((mode || "").toLowerCase()) {
    case "remote":
      return "Remote"
    case "hybrid":
      return "Hybrid"
    case "onsite":
    case "on-site":
      return "On-Site"
    default:
      return null
  }
}

/**
 * --jobage days -> Dice filters.postedDate bucket (ONE = today, THREE = last
 * 3 days, SEVEN = last 7 days). Larger windows have no server bucket and are
 * filtered client-side only.
 */
export function postedDateFilter(days: number | undefined): string | null {
  if (!days || days <= 0) return null
  if (days <= 1) return "ONE"
  if (days <= 3) return "THREE"
  if (days <= 7) return "SEVEN"
  return null
}

/** Keep cards posted within `days` of `now` (cards without a date are dropped). */
export function filterByAge(cards: JobCard[], days: number | undefined, now = Date.now()): JobCard[] {
  if (!days || days <= 0) return cards
  const cutoff = now - days * 86400_000
  return cards.filter((c) => {
    if (!c.date) return false
    const t = Date.parse(c.date)
    return Number.isFinite(t) && t >= cutoff
  })
}

// ---------------------------------------------------------------------------
// Detail parsing
// ---------------------------------------------------------------------------

export interface JobDetail {
  id: string
  title: string | null
  company: string | null
  location: string | null
  date: string | null
  url: string
  validThrough: string | null
  workplace: string | null // header badge, e.g. "Remote", "Hybrid", "On-Site"
  jobLocationType: string | null // JSON-LD, e.g. "TELECOMMUTE"
  employmentType: string | null // JSON-LD, e.g. "CONTRACTOR", "FULL_TIME"
  employmentTypes: string[] // header badges, e.g. ["Contract Corp To Corp","Contract W2"]
  contractDuration: string | null
  salary: string | null
  applicantLocation: string | null // JSON-LD applicantLocationRequirements
  skills: string[]
  badges: string[]
  description: string | null
}

function findJobPostingLd(html: string): Record<string, unknown> | null {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    try {
      const j = JSON.parse(m[1])
      const list = Array.isArray(j) ? j : [j]
      for (const item of list) {
        if (item && typeof item === "object" && item["@type"] === "JobPosting") return item
      }
    } catch {
      // ignore an unparsable block
    }
  }
  return null
}

const EMPLOYMENT_BADGE = /^(contract|full[ -]?time|part[ -]?time|third party|c2c|corp to corp|w2|temporary|internship|permanent)/i

/** Parse the header-card info badges: [{text, testid}] in page order. */
function parseBadges(html: string): Array<{ text: string; testid: string | null }> {
  const start = html.indexOf('data-testid="job-detail-header-card"')
  let scope = start === -1 ? html : html.slice(start, start + 30000)
  // The header badges end before the company-branding card / "Job Details"
  // section, whose skill chips reuse the same SeuiInfoBadge class.
  const ends = ["Company Branding Image", ">Job Details<", "Dice Job Match Score"]
    .map((s) => scope.indexOf(s))
    .filter((i) => i > 0)
  if (ends.length) scope = scope.slice(0, Math.min(...ends))
  const out: Array<{ text: string; testid: string | null }> = []
  const chunks = scope.split(/<div class="SeuiInfoBadge/).slice(1)
  for (const chunk of chunks) {
    const tagEnd = chunk.indexOf(">")
    const openTag = chunk.slice(0, tagEnd)
    const testid = openTag.match(/data-testid="([^"]+)"/)?.[1] ?? null
    const inner = chunk.slice(tagEnd + 1).match(/^\s*<div[^>]*>([\s\S]*?)<\/div>/)
    const text = inner ? clean(inner[1]) : ""
    if (text) out.push({ text, testid })
  }
  return out
}

function ldLocation(ld: Record<string, unknown>): string | null {
  const raw = ld.jobLocation
  const list = Array.isArray(raw) ? raw : raw ? [raw] : []
  const parts: string[] = []
  for (const loc of list) {
    const addr = (loc as Record<string, unknown>)?.address as Record<string, unknown> | undefined
    if (!addr) continue
    const p = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
      .map((x) => (typeof x === "string" ? x : (x as Record<string, unknown>)?.name))
      .filter((x): x is string => typeof x === "string" && !!x.trim())
    if (p.length) parts.push(p.join(", "))
  }
  return parts.length ? parts.join(" / ") : null
}

export function parseJobDetail(html: string, id: string): JobDetail {
  const ld = findJobPostingLd(html) ?? {}
  const org = ld.hiringOrganization as Record<string, unknown> | undefined
  const salary = ld.baseSalary as Record<string, unknown> | undefined
  const applicant = ld.applicantLocationRequirements as Record<string, unknown> | undefined

  const badges = parseBadges(html)
  const workplace = badges.find((b) => b.testid === "locationTypeBadge")?.text ?? null
  const contractDuration = badges.find((b) => b.testid === "contractDurationBadge")?.text ?? null
  const employmentTypes = badges.filter((b) => !b.testid && EMPLOYMENT_BADGE.test(b.text)).map((b) => b.text)

  // Skills appear in the flight payload as "skills":["A","B"].
  let skills: string[] = []
  const flight = extractFlight(html)
  const sk = flight.match(/"skills":(\[[^\]]*\])/)
  if (sk) {
    try {
      const arr = JSON.parse(sk[1])
      if (Array.isArray(arr)) skills = arr.filter((x): x is string => typeof x === "string")
    } catch {
      // ignore
    }
  }

  let salaryText: string | null = null
  if (salary) {
    const v = salary.value
    if (typeof v === "string") salaryText = v
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>
      const range = [o.minValue, o.maxValue].filter((x) => x !== undefined).join("-")
      const unit = typeof o.unitText === "string" ? `/${o.unitText.toLowerCase()}` : ""
      salaryText = range ? `${range}${unit}` : null
    }
    if (salaryText && typeof salary.currency === "string" && /\d/.test(salaryText)) {
      salaryText = `${salary.currency} ${salaryText}`
    }
  }

  const desc = str(ld.description)
  const empType = Array.isArray(ld.employmentType)
    ? (ld.employmentType as unknown[]).filter((x) => typeof x === "string").join(", ") || null
    : str(ld.employmentType)

  return {
    id,
    title: str(ld.title) ? clean(ld.title as string) : null,
    company: org ? str(org.name) : null,
    location: ldLocation(ld),
    date: str(ld.datePosted),
    url: str(ld.url) ?? `${DETAIL_URL}/${id}`,
    validThrough: str(ld.validThrough),
    workplace,
    jobLocationType: str(ld.jobLocationType),
    employmentType: empType,
    employmentTypes,
    contractDuration,
    salary: salaryText,
    applicantLocation: applicant ? str(applicant.name) : null,
    skills,
    badges: badges.map((b) => b.text),
    description: desc ? htmlToText(desc) || null : null,
  }
}

/**
 * Accept a bare Dice job GUID or a dice.com /job-detail/<uuid> URL (with or
 * without scheme). URLs on any other host are rejected, using real URL
 * parsing so look-alike hosts and userinfo tricks fall on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (UUID_RE.test(trimmed)) return trimmed.toLowerCase()
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (!hasScheme && !/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
  } catch {
    return null
  }
  if (!/(^|\.)dice\.com$/i.test(parsed.hostname)) return null
  const m = parsed.pathname.match(/^\/job-detail\/([0-9a-f-]{36})\/?$/i)
  return m && UUID_RE.test(m[1]) ? m[1].toLowerCase() : null
}
