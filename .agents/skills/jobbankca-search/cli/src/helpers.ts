// Data source: Job Bank Canada (https://www.jobbank.gc.ca), the Government of
// Canada job board. No authentication required. Search returns a server-rendered
// HTML results page (25 <article> cards per page); detail returns one posting's
// HTML page, annotated with Schema.org JobPosting RDFa (property="title",
// "datePosted", "hiringOrganization", "validThrough", ...). There is no JSON-LD.
// We parse both with chunked regex - zero runtime dependencies.
//
// robots.txt: `User-agent: *` / `Crawl-delay: 5`, nothing disallowed. The CLI
// spaces every request it makes at least CRAWL_DELAY_MS apart, across
// invocations too (a timestamp file in the OS temp dir), so /scrape loops stay
// within the crawl delay.

import { tmpdir } from "os"
import { join } from "path"
import { readFileSync, writeFileSync } from "fs"

export const BASE_URL = "https://www.jobbank.gc.ca"
export const SEARCH_URL = `${BASE_URL}/jobsearch/jobsearch`
export const DETAIL_URL = `${BASE_URL}/jobsearch/jobposting`
export const CITY_SUGGEST_URL = `${BASE_URL}/core/ta-cityprovsuggest_en/select`

/** robots.txt Crawl-delay is 5 seconds. */
export const CRAWL_DELAY_MS = 5000

const UA = "Mozilla/5.0 (compatible; jobbankca-cli/1.0)"
const STAMP_FILE = join(tmpdir(), "jobbankca-cli-last-request")

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Wait until at least CRAWL_DELAY_MS has passed since the last request any
 * jobbankca-cli process made, then record this request's time. Best effort:
 * an unreadable/unwritable stamp file never blocks the request.
 */
export async function politeWait(delayMs = CRAWL_DELAY_MS): Promise<void> {
  if (delayMs <= 0) return
  let last = 0
  try {
    last = Number(readFileSync(STAMP_FILE, "utf8").trim()) || 0
  } catch {
    // first request, or temp dir unavailable
  }
  const wait = last + delayMs - Date.now()
  if (wait > 0 && wait <= delayMs) await sleep(wait)
  try {
    writeFileSync(STAMP_FILE, String(Date.now()))
  } catch {
    // ignore
  }
}

export interface FetchResult {
  /** Response body; "" on a 404/410. */
  body: string
  /** Final URL after redirects (an expired posting redirects to /jobsearch/jobpostingexpired). */
  url: string
  status: number
}

/**
 * Fetch a URL with exponential backoff (plus jitter) on 429/5xx, at most 6
 * retries. Every attempt goes through politeWait(), so retries also respect
 * the crawl delay. Returns an empty body on a 404.
 */
export async function htmlFetch(url: string, accept = "text/html,application/xhtml+xml"): Promise<FetchResult> {
  const maxRetries = 6
  let delay = 1000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await politeWait()
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: accept,
        "Accept-Language": "en-CA,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 1000)
      await sleep(delay + jitter)
      delay = Math.min(delay * 2, 30000)
      continue
    }
    const finalUrl = response.url || url
    // 404: unknown path. 410: Job Bank's /jobsearch/jobpostingexpired page,
    // where a removed posting's 302 lands - "gone", not a failure.
    if (response.status === 404 || response.status === 410) return { body: "", url: finalUrl, status: response.status }
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return { body: await response.text(), url: finalUrl, status: response.status }
  }
  throw new Error("Request failed after max retries")
}

// ---------------------------------------------------------------------------
// Text helpers

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&ndash;/g, "–")
    .replace(/&mdash;/g, "—")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&agrave;/g, "à")
    .replace(/&ccedil;/g, "ç")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&amp;/g, "&")
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/** Drop the screen-reader-only labels (<span class="wb-inv">Location</span>) before cleaning. */
function dropWbInv(html: string): string {
  return html.replace(/<span class="wb-inv[^"]*"[^>]*>[\s\S]*?<\/span>/gi, " ")
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  janvier: 1, "février": 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, "août": 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, "décembre": 12, decembre: 12,
}

/** "November 01, 2026" (or French "1 novembre 2026", or ISO) -> "2026-11-01". */
export function parseDate(text: string | null | undefined): string | null {
  if (!text) return null
  const t = text.trim()
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const pad = (n: number) => String(n).padStart(2, "0")
  const en = t.match(/([A-Za-zéû]+)\s+(\d{1,2}),\s*(\d{4})/)
  if (en && MONTHS[en[1].toLowerCase()]) {
    return `${en[3]}-${pad(MONTHS[en[1].toLowerCase()])}-${pad(parseInt(en[2], 10))}`
  }
  const fr = t.match(/(\d{1,2})(?:er)?\s+([A-Za-zéû]+)\s+(\d{4})/)
  if (fr && MONTHS[fr[2].toLowerCase()]) {
    return `${fr[3]}-${pad(MONTHS[fr[2].toLowerCase()])}-${pad(parseInt(fr[1], 10))}`
  }
  return null
}

// ---------------------------------------------------------------------------
// Filters

export type Workplace = "remote" | "hybrid" | "onsite"

/**
 * Work-location filter values, read from the live search page's "Work location"
 * facet (id="remotework-type"), parameter `fskl`:
 *   Remote  -> fskl=15141
 *   Hybrid  -> fskl=100000
 *   On site -> fskl=¬15141 & ¬100000 & ¬100001 & ¬100006 (the site's own
 *              "On site" checkbox sends exactly these four negations)
 */
export function workplaceParams(mode: Workplace | undefined): string[] {
  switch (mode) {
    case "remote":
      return ["15141"]
    case "hybrid":
      return ["100000"]
    case "onsite":
      return ["¬15141", "¬100000", "¬100001", "¬100006"]
    default:
      return []
  }
}

export function normalizeWorkplace(mode: string): Workplace | null {
  const m = mode.trim().toLowerCase().replace(/[\s_]+/g, "-")
  if (m === "remote" || m === "telework" || m === "teletravail" || m === "télétravail") return "remote"
  if (m === "hybrid" || m === "hybride") return "hybrid"
  if (m === "onsite" || m === "on-site" || m === "sur-place") return "onsite"
  return null
}

/** Map a card/detail "Work location" label to remote|hybrid|onsite (null if unknown). */
export function workplaceFromLabel(label: string | null): Workplace | null {
  if (!label) return null
  const l = label.toLowerCase()
  if (/hybrid|hybride/.test(l)) return "hybrid"
  if (/remote|télétravail|teletravail|à distance/.test(l)) return "remote"
  if (/on site|on-site|sur place|on the road|relocation/.test(l)) return "onsite"
  return null
}

/**
 * Date-posted facet (`fage`) only offers "Last 48 hours" (2) and "Last 30 days"
 * (30). We request the smallest bucket that covers --jobage and then filter the
 * cards' dates client-side for the exact window.
 */
export function jobageToFage(days: number | undefined): string | null {
  if (!days) return null
  if (days <= 2) return "2"
  if (days <= 30) return "30"
  return null
}

export const PROVINCES: Record<string, string> = {
  AB: "alberta", BC: "british columbia", MB: "manitoba", NB: "new brunswick",
  NL: "newfoundland and labrador", NS: "nova scotia", NT: "northwest territories",
  NU: "nunavut", ON: "ontario", PE: "prince edward island", QC: "quebec",
  SK: "saskatchewan", YT: "yukon",
}
const PROVINCE_ALIASES: Record<string, string> = {
  "québec": "QC", "colombie-britannique": "BC", "nouveau-brunswick": "NB",
  "terre-neuve-et-labrador": "NL", "nouvelle-écosse": "NS", "territoires du nord-ouest": "NT",
  "île-du-prince-édouard": "PE", "pei": "PE", "newfoundland": "NL", "nfld": "NL",
}

/** "ON", "Ontario", "ontario" -> "ON"; anything else -> null. */
export function provinceCode(text: string): string | null {
  const t = text.trim().toLowerCase()
  if (PROVINCES[t.toUpperCase()]) return t.toUpperCase()
  for (const [code, name] of Object.entries(PROVINCES)) if (name === t) return code
  return PROVINCE_ALIASES[t] ?? null
}

export interface CityMatch {
  cityId: string
  name: string
  province: string
}

/**
 * Parse the city-suggest Solr response (/core/ta-cityprovsuggest_en/select).
 * Picks the first city doc, preferring one in `wantProvince` when given.
 */
export function parseCitySuggest(json: string, wantCity: string, wantProvince: string | null): CityMatch | null {
  let docs: Array<Record<string, unknown>> = []
  try {
    docs = (JSON.parse(json)?.response?.docs ?? []) as Array<Record<string, unknown>>
  } catch {
    return null
  }
  const cities = docs.filter((d) => typeof d.city_id === "string" || typeof d.city_id === "number")
  const want = wantCity.trim().toLowerCase()
  const score = (d: Record<string, unknown>) =>
    (String(d.name ?? "").toLowerCase() === want ? 2 : 0) +
    (wantProvince && d.province_cd === wantProvince ? 1 : 0)
  const ranked = cities
    .filter((d) => !wantProvince || d.province_cd === wantProvince)
    .sort((a, b) => score(b) - score(a))
  const best = ranked[0]
  if (!best) return null
  return { cityId: String(best.city_id), name: String(best.name ?? wantCity), province: String(best.province_cd ?? "") }
}

// ---------------------------------------------------------------------------
// Search results

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  workplace: Workplace | null
  salary: string | null
  source: string | null
  sourceJobNumber: string | null
}

export function postingUrl(id: string): string {
  return `${DETAIL_URL}/${id}`
}

/** Total hit count from <span class="found" id="results-count">273</span>. */
export function parseTotal(html: string): number | null {
  const m = html.match(/id="results-count"[^>]*>\s*(\d[\d,]*)\s*</)
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null
}

/**
 * Parse the search page: split on each <article id="article-<id>"> and parse
 * each chunk independently so one malformed card cannot break the rest.
 */
export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = html.split(/<article\s+id="article-/).slice(1)
  for (const raw of chunks) {
    const idMatch = raw.match(/^(\d+)"/)
    if (!idMatch) continue
    const id = idMatch[1]
    const end = raw.indexOf("</article>")
    const chunk = end === -1 ? raw : raw.slice(0, end)

    const titleM = chunk.match(/class="noctitle"[^>]*>([\s\S]*?)<\/span>/i)
    const title = titleM ? clean(titleM[1]) : ""
    if (!title) continue

    const pick = (cls: string): string | null => {
      const m = chunk.match(new RegExp(`<li class="${cls}"[^>]*>([\\s\\S]*?)</li>`, "i"))
      if (!m) return null
      return clean(dropWbInv(m[1])) || null
    }

    const company = pick("business")
    const location = pick("location")
    const date = parseDate(pick("date"))
    const salaryRaw = pick("salary")
    const salary = salaryRaw ? salaryRaw.replace(/^Salary\s*/i, "").trim() || null : null

    let source: string | null = null
    let sourceJobNumber: string | null = null
    const srcM = chunk.match(/<li class="source"[^>]*>([\s\S]*?)<\/li>/i)
    if (srcM) {
      const s = srcM[1].match(/<span class="wb-inv">([^<]+)<\/span>/i)
      source = s ? clean(s[1]) || null : null
      const num = clean(dropWbInv(srcM[1])).match(/([A-Za-z0-9-]+)\s*$/)
      sourceJobNumber = num ? num[1] : null
    }

    const tw = chunk.match(/<span class="telework"[^>]*>([\s\S]*?)<\/span>/i)
    const workplace = tw ? workplaceFromLabel(clean(tw[1])) : null

    results.push({
      id,
      title,
      company,
      location,
      date,
      url: postingUrl(id),
      workplace,
      salary,
      source,
      sourceJobNumber,
    })
  }
  return results
}

// ---------------------------------------------------------------------------
// Detail page

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  workplace: Workplace | null
  workplaceLabel: string | null
  salary: string | null
  employmentType: string | null
  startDate: string | null
  vacancies: string | null
  source: string | null
  sourceJobNumber: string | null
  applyUrl: string | null
  deadline: string | null
  description: string | null
  isActive: boolean
}

/** Find the content of the <li> in the job-posting-brief list whose screen-reader label is `label`. */
function briefItem(brief: string, label: string): string | null {
  const items = brief.split(/<li[\s>]/i).slice(1)
  for (const it of items) {
    const re = new RegExp(`<span class="wb-inv">\\s*${label}\\s*</span>`, "i")
    if (re.test(it)) {
      const after = it.split(re)[1] ?? ""
      return after
    }
  }
  return null
}

/**
 * Render the structured "Overview" block of a Job Bank-direct posting
 * (h3/h4 headings over csvlist spans) as readable text with bullets.
 */
function renderOverview(html: string): string {
  const withoutModals = html
    .replace(/<section[^>]*class="[^"]*mfp-hide[^"]*"[\s\S]*?<\/section>/gi, " ")
    .replace(/<a[^>]*class="[^"]*dialog-help[^"]*"[\s\S]*?<\/a>/gi, " ")
    .replace(/<span class="fa[^"]*"[^>]*><\/span>/gi, " ")
  const marked = withoutModals
    .replace(/\s+/g, " ")
    .replace(/<h3[^>]*>/gi, "\n\n## ")
    .replace(/<\/h3>/gi, "\n")
    .replace(/<h4[^>]*>/gi, "\n\n")
    .replace(/<\/h4>/gi, ":\n")
    .replace(/<ul[^>]*class="[^"]*csvlist[^"]*"[^>]*>/gi, "\n")
    .replace(/<(?:li|span)>\s*<span>/gi, "\n- <span>")
    .replace(/<ul[^>]*class="[^"]*csvlist[^"]*"[^>]*>\s*<span>/gi, "\n- <span>")
    .replace(/<\/span>\s*<span>/gi, "</span>\n- <span>")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|ul|ol|div)>/gi, "\n")
  return marked
    .split("\n")
    .map((line) => {
      const bullet = /^\s*-\s/.test(line)
      const heading = /^\s*##\s/.test(line)
      const text = clean(line.replace(/^\s*(-|##)\s/, ""))
      if (!text) return ""
      return bullet ? `- ${text}` : heading ? `## ${text}` : text
    })
    .join("\n")
    .replace(/\s+:\n/g, ":\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .replace(/^## Overview\n+/, "")
}

export function isExpiredUrl(url: string): boolean {
  return /\/jobsearch\/jobpostingexpired/i.test(url)
}

export function parseJobDetail(html: string, id: string): JobDetail {
  const titleM = html.match(/property="title"[^>]*>([\s\S]*?)<\/span>/i)
  const title = titleM ? clean(titleM[1]) : ""

  const dateM = html.match(/property="datePosted"[^>]*>([\s\S]*?)<\/span>/i)
  const date = dateM ? parseDate(clean(dateM[1])) : null

  let company: string | null = null
  const orgM = html.match(/property="hiringOrganization"[^>]*>\s*<span property="name"[^>]*>([\s\S]*?)<\/span>\s*<\/span>/i)
  if (orgM) {
    company = clean(dropWbInv(orgM[1]).replace(/<span class="fa[^"]*"[^>]*><\/span>/gi, "")) || null
  }

  const briefM = html.match(/<ul class="job-posting-brief[^"]*"[^>]*>([\s\S]*?)<\/ul>/i)
  const brief = briefM ? briefM[1] : ""

  // Location: "Regina, SK" (RDFa address) or "Remote based in Toronto, ON".
  const locRaw = briefItem(brief, "Location")
  let location: string | null = null
  if (locRaw) {
    const firstSpan = locRaw.split(/<span class="wb-inv">/i)[0]
    location = clean(firstSpan).replace(/\s+,/g, ",") || null
  }

  const wlRaw = briefItem(brief, "Work location")
  let workplaceLabel: string | null = null
  if (wlRaw) {
    const m = wlRaw.match(/<span>([\s\S]*?)<\/span>/i)
    workplaceLabel = m ? clean(m[1]) || null : null
  }
  // Fallback: the hidden description ends with "Workplace information: Remote."
  const hiddenDescM = html.match(/<span class="hidden" property="description">([\s\S]*?)<\/span>/i)
  const hiddenDesc = hiddenDescM ? clean(hiddenDescM[1]) : ""
  if (!workplaceLabel) {
    const wi = hiddenDesc.match(/Workplace information:\s*([^.]+)\./i)
    if (wi) workplaceLabel = wi[1].trim()
  }
  const workplace = workplaceFromLabel(workplaceLabel)

  const salM = html.match(/property="baseSalary"[^>]*>([\s\S]*?)<\/li>/i)
  const salary = salM
    ? clean(salM[1].replace(/<span property="unitText"[^>]*>[\s\S]*?<\/span>/gi, "").replace(/<span id="tp_[^"]*"[^>]*><\/span>/gi, "")).replace(/\$\s+/g, "$") || null
    : null

  const empM = html.match(/property="employmentType"[^>]*>([\s\S]*?)<\/li>/i)
  let employmentType: string | null = null
  if (empM) {
    const parts = empM[1]
      .split(/<span[^>]*>/i)
      .map((p) => clean(p))
      .filter(Boolean)
    employmentType = parts.length ? parts.join(", ") : null
  }

  let startDate: string | null = null
  const startM = brief.match(/<span>\s*(Starts[^<]*)<\/span>/i)
  if (startM) startDate = clean(startM[1])

  let vacancies: string | null = null
  const vacRaw = briefItem(brief, "vacancies")
  if (vacRaw) {
    const m = vacRaw.match(/<span>([\s\S]*?)<\/span>/i)
    vacancies = m ? clean(m[1]) || null : null
  }

  let source: string | null = null
  let sourceJobNumber: string | null = null
  const srcRaw = briefItem(brief, "Source")
  if (srcRaw) {
    const spans = [...srcRaw.matchAll(/<span>([^<]*)<\/span>/gi)].map((m) => clean(m[1])).filter(Boolean)
    source = spans.find((s) => !s.startsWith("#")) ?? null
    const num = spans.find((s) => s.startsWith("#"))
    sourceJobNumber = num ? num.slice(1) : null
  }

  // Apply / full-posting link (partner postings: #externalJobLink; employer
  // postings: "Learn more about this job" inside .external-job).
  let applyUrl: string | null = null
  const extM =
    html.match(/<a[^>]*id="externalJobLink"[^>]*href="([^"]+)"/i) ??
    html.match(/<a[^>]*href="([^"]+)"[^>]*id="externalJobLink"/i) ??
    html.match(/<div class="external-job[^"]*">[\s\S]*?<a[^>]*href="([^"]+)"/i)
  if (extM) applyUrl = decodeHtmlEntities(extM[1])

  const deadM = html.match(/property="validThrough"[^>]*>([\s\S]*?)</i)
  const deadline = deadM ? parseDate(clean(deadM[1])) : null

  // Description: the structured Overview block when the employer posted on Job
  // Bank directly; otherwise (partner postings) the free-text description that
  // Job Bank carries in the hidden RDFa description span.
  let description: string | null = null
  const reqStart = html.search(/<div class="main-job-posting-detail job-posting-detail-requirements/i)
  if (reqStart !== -1) {
    const rest = html.slice(reqStart)
    const stop = rest.search(/<div[^>]*class="job-posting-detail-apply"|<div class="job-posting-detail-common"/i)
    const block = stop === -1 ? rest : rest.slice(0, stop)
    description = renderOverview(block) || null
  }
  if (!description && hiddenDesc) {
    // The hidden span is whitespace-collapsed; restore the breaks partner
    // feeds encode as run-together sentences, "*Heading*" and " * " bullets.
    description = hiddenDesc
      .replace(/([.!?])(?=[A-Z])/g, "$1\n")
      .replace(/(^|\s)\*([^*\s][^*\n]{0,58}?[^*\s])\*(?=\s|$)/g, "\n\n$2\n")
      .replace(/\s+\*\s+/g, "\n- ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  }

  // Expired postings never reach this parser: Job Bank answers them with a 302
  // to /jobsearch/jobpostingexpired, which runDetail() reports as
  // isActive:false. A page that carries the JobPosting title is live.
  const isActive = !!title

  return {
    id,
    title: title || "(untitled)",
    company,
    location,
    date,
    url: postingUrl(id),
    workplace,
    workplaceLabel,
    salary,
    employmentType,
    startDate,
    vacancies,
    source,
    sourceJobNumber,
    applyUrl,
    deadline,
    description,
    isActive,
  }
}
