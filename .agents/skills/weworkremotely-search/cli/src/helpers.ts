// Data source: We Work Remotely's public, server-rendered pages. No authentication.
//   search:   https://weworkremotely.com/remote-jobs/search?term=<q>   (all matching active jobs, one page)
//   category: https://weworkremotely.com/categories/<slug>             (all active jobs in one category)
//   detail:   https://weworkremotely.com/remote-jobs/<slug>             (JSON-LD JobPosting + sidebar)
// robots.txt allows all of these (it disallows only admin/account/manage paths).
// Both listing pages are a flat list of <li> cards; we split per card and parse
// each chunk independently so one malformed card cannot break the rest.

export const BASE_URL = "https://weworkremotely.com"
export const SEARCH_URL = `${BASE_URL}/remote-jobs/search`
export const CATEGORY_URL = `${BASE_URL}/categories`
export const DETAIL_URL = `${BASE_URL}/remote-jobs`

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; weworkremotely-cli/1.0)"

/** Fetch HTML with exponential backoff + jitter on 429/5xx. Returns "" on a 404. */
export async function htmlFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

// --- Categories ---------------------------------------------------------------

/**
 * WWR categories: short key -> { slug (URL path under /categories/), id (the
 * `data-category` attribute on listing cards) }. IDs read from the
 * `<section class="jobs" id="category-N">` blocks and card attributes
 * (verified live 2026-11-01).
 */
export const CATEGORIES: Record<string, { slug: string; id: string; label: string }> = {
  "full-stack-programming": { slug: "remote-full-stack-programming-jobs", id: "2", label: "Full-Stack Programming" },
  "front-end-programming": { slug: "remote-front-end-programming-jobs", id: "17", label: "Front-End Programming" },
  "back-end-programming": { slug: "remote-back-end-programming-jobs", id: "18", label: "Back-End Programming" },
  "devops-sysadmin": { slug: "remote-devops-sysadmin-jobs", id: "6", label: "DevOps and Sysadmin" },
  design: { slug: "remote-design-jobs", id: "1", label: "Design" },
  product: { slug: "remote-product-jobs", id: "11", label: "Product" },
  "customer-support": { slug: "remote-customer-support-jobs", id: "7", label: "Customer Support" },
  "sales-and-marketing": { slug: "remote-sales-and-marketing-jobs", id: "9", label: "Sales and Marketing" },
  "management-and-finance": { slug: "remote-management-and-finance-jobs", id: "3", label: "Management and Finance" },
  "all-other": { slug: "all-other-remote-jobs", id: "4", label: "All Other Remote" },
}

/** Resolve a category given as short key ("devops-sysadmin") or full slug ("remote-devops-sysadmin-jobs"). */
export function resolveCategory(input: string): { key: string; slug: string; id: string; label: string } | null {
  const v = input.trim().toLowerCase().replace(/\.rss$/, "").replace(/^\/?categories\//, "")
  for (const [key, c] of Object.entries(CATEGORIES)) {
    if (v === key || v === c.slug) return { key, ...c }
  }
  return null
}

// --- Text helpers -------------------------------------------------------------

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
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&amp;/g, "&") // last, so "&amp;lt;" decodes to "&lt;", not "<"
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html)).replace(/\s+/g, " ").trim()
}

/** HTML fragment -> readable text, keeping paragraph / list-item / heading breaks. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|ul|ol|div|h\d)>/gi, "\n") // </li> needs none: the next <li> opens its own line
  return withBreaks
    .split("\n")
    .map((line) => (line.startsWith("- ") ? "- " + clean(line.slice(2)) : clean(line)))
    .filter((line, i, arr) => !(line === "-" || (line === "" && arr[i - 1] === "")))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Inner HTML of the first <div> whose class contains `className`, depth-tracked for nested divs. */
export function extractDivContent(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const openRe = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, "i")
  const open = openRe.exec(html)
  if (!open) return null
  let i = open.index + open[0].length
  let depth = 1
  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf("<div", i)
    const nextClose = html.indexOf("</div>", i)
    if (nextClose === -1) return null
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }
  return html.slice(open.index + open[0].length, i - 6)
}

// --- Age / date ---------------------------------------------------------------

/**
 * Listing cards carry only a relative age: "New" (posted within ~2 days),
 * "4d", "28d" and so on. Convert to whole days; null when unrecognised.
 */
export function ageToDays(age: string | null): number | null {
  if (!age) return null
  const a = age.trim().toLowerCase()
  if (a === "new" || a === "today" || a === "just now") return 0
  const m = a.match(/^(\d+)\s*(m|min|h|d|w|mo|y)$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  switch (m[2]) {
    case "m":
    case "min":
    case "h":
      return 0
    case "d":
      return n
    case "w":
      return n * 7
    case "mo":
      return n * 30
    case "y":
      return n * 365
  }
  return null
}

/** Days-ago -> approximate YYYY-MM-DD (UTC). */
export function daysAgoToDate(days: number | null, now: Date = new Date()): string | null {
  if (days === null) return null
  const d = new Date(now.getTime() - days * 86400000)
  return d.toISOString().slice(0, 10)
}

// --- Search cards -------------------------------------------------------------

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  region: string | null
  regions: string[]
  date: string | null
  age: string | null
  ageDays: number | null
  jobType: string | null
  salary: string | null
  hq: string | null
  categoryId: string | null
  category: string | null
  featured: boolean
  url: string
}

const JOB_TYPE_RE = /^(full[- ]time|part[- ]time|contract|freelance|internship|temporary|full-time\/part-time)$/i
const BADGE_RE = /^(boosted|top 100|featured|new|promoted)$/i
// Salary pills: "$100,000 or more USD", "$75,000 - $99,999 USD", "$20/hr+".
const SALARY_RE = /^[$€£]\s?\d|\d\s*(usd|eur|gbp|cad)\b|\/\s*(hr|hour|year|yr)\b/i

/** Strip leading flag emoji (regional-indicator pairs) from a country pill. */
function stripFlag(s: string): string {
  return s.replace(/^(?:[\u{1F1E6}-\u{1F1FF}]{2}\s*)+/u, "").trim()
}

export function parseJobCards(html: string): JobCard[] {
  const results: JobCard[] = []
  const seen = new Set<string>()
  const chunks = html.split(/<li\b/i).slice(1)
  const idToLabel: Record<string, string> = {}
  for (const c of Object.values(CATEGORIES)) idToLabel[c.id] = c.label

  for (const raw of chunks) {
    try {
      // A card's <li> ends at its first </li>; cards contain no nested <li>.
      const end = raw.indexOf("</li>")
      const chunk = end === -1 ? raw : raw.slice(0, end)
      // Skip paid ad cards (they link to /listing_ads/... not /remote-jobs/<slug>).
      if (/listing-ad\b/.test(chunk.slice(0, 300))) continue
      const link = chunk.match(/<a[^>]*class="listing-link[^"]*"[^>]*href="\/remote-jobs\/([a-z0-9][a-z0-9-]*)"/i)
      if (!link) continue
      const id = link[1]
      if (id === "find-your-plan" || seen.has(id)) continue

      const titleM =
        chunk.match(/class="new-listing__header__title__text"[^>]*>([\s\S]*?)<\/span>/i) ??
        chunk.match(/class="new-listing__header__title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i)
      const title = titleM ? clean(titleM[1]) : ""
      if (!title) continue

      const compM = chunk.match(/class="new-listing__company-name"[^>]*>([\s\S]*?)<\/p>/i)
      const company = compM ? clean(compM[1]) || null : null

      const hqM = chunk.match(/class="new-listing__company-headquarters[^"]*"[^>]*>([\s\S]*?)<\/p>/i)
      const hq = hqM ? clean(hqM[1]).replace(/^HQ:\s*/i, "") || null : null

      const ageM = chunk.match(/class="new-listing__header__icons__date"[^>]*>([\s\S]*?)<\/p>/i)
      const age = ageM ? clean(ageM[1]) || null : null
      const ageDays = ageToDays(age)

      const pills: string[] = []
      const pillRe = /class="new-listing__categories__category[^"]*"[^>]*>([\s\S]*?)<\/p>/gi
      let pm: RegExpExecArray | null
      while ((pm = pillRe.exec(chunk)) !== null) {
        const t = clean(pm[1])
        if (t) pills.push(t)
      }
      let jobType: string | null = null
      let salary: string | null = null
      const regions: string[] = []
      for (const p of pills) {
        if (BADGE_RE.test(p)) continue
        if (!jobType && JOB_TYPE_RE.test(p)) {
          jobType = p
          continue
        }
        if (!salary && SALARY_RE.test(p)) {
          salary = p
          continue
        }
        regions.push(stripFlag(p))
      }
      const region = regions.length ? regions.join(", ") : null

      const catM = raw.match(/^[^>]*data-category="(\d+)"/)
      const categoryId = catM ? catM[1] : null

      results.push({
        id,
        title,
        company,
        location: region,
        region,
        regions,
        date: daysAgoToDate(ageDays),
        age,
        ageDays,
        jobType,
        salary,
        hq,
        categoryId,
        category: categoryId ? idToLabel[categoryId] ?? null : null,
        featured: /^[^>]*class="[^"]*\bfeature\b/.test(raw),
        url: `${DETAIL_URL}/${id}`,
      })
      seen.add(id)
    } catch {
      // One malformed card must not break the rest.
      continue
    }
  }
  return results
}

// --- Eligibility --------------------------------------------------------------

/** Region groups WWR uses, and the countries each group covers (for --eligible). */
const GROUP_MEMBERS: Record<string, string[]> = {
  "north america": ["canada", "usa", "united states", "mexico"],
  americas: ["canada", "usa", "united states", "mexico", "brazil", "argentina", "chile", "colombia", "peru"],
  "latin america": ["mexico", "brazil", "argentina", "chile", "colombia", "peru", "uruguay", "costa rica"],
  europe: [
    "united kingdom", "uk", "germany", "france", "spain", "portugal", "italy", "netherlands", "poland",
    "ireland", "sweden", "norway", "denmark", "finland", "austria", "switzerland", "belgium",
  ],
  emea: ["united kingdom", "uk", "germany", "france", "spain", "portugal", "italy", "netherlands", "poland"],
}

const COUNTRY_ALIASES: Record<string, string[]> = {
  usa: ["usa", "united states", "u.s."],
  "united states": ["usa", "united states", "u.s."],
  us: ["usa", "united states", "u.s."],
  uk: ["uk", "united kingdom"],
  "united kingdom": ["uk", "united kingdom"],
}

/**
 * True when a job's region pills say someone in `country` may apply:
 * "Anywhere in the World", a pill naming the country, or a group pill
 * ("North America Only", "Americas Only", ...) that covers it.
 * A job with no region information is NOT treated as eligible.
 */
export function isEligible(regions: string[], country: string): boolean {
  const c = country.trim().toLowerCase()
  const names = COUNTRY_ALIASES[c] ?? [c]
  for (const raw of regions) {
    const r = raw.toLowerCase()
    if (/anywhere|worldwide/.test(r)) return true
    if (names.some((n) => new RegExp(`(^|[^a-z])${n.replace(/[.]/g, "\\.")}([^a-z]|$)`).test(r))) return true
    for (const [group, members] of Object.entries(GROUP_MEMBERS)) {
      // "north america" / "latin america" / "americas" are disjoint substrings.
      if (r.includes(group) && names.some((n) => members.includes(n))) {
        return true
      }
    }
  }
  return false
}

/** Whole-word match of every query word against title + company (for --exact). */
export function matchesExact(card: Pick<JobCard, "title" | "company">, query: string): boolean {
  const hay = `${card.title} ${card.company ?? ""}`.toLowerCase()
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return words.every((w) => {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(hay)
  })
}

// --- Detail -------------------------------------------------------------------

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  region: string | null
  regions: string[]
  applicantCountries: string[]
  date: string | null
  validThrough: string | null
  jobType: string | null
  category: string | null
  hq: string | null
  salary: string | null
  description: string | null
  url: string
  isActive: boolean
}

function ldField(ld: string, key: string): string | null {
  const m = ld.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`))
  return m ? m[1].replace(/\\"/g, '"').replace(/\\\//g, "/") : null
}

/** "2026-10-29 07:30:52 UTC" -> "2026-10-29T07:30:52Z"; anything else passes through. */
function ldDate(v: string | null): string | null {
  if (!v) return null
  const m = v.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*UTC|Z)?$/)
  return m ? `${m[1]}T${m[2]}Z` : v
}

export function parseJobDetail(html: string, id: string): JobDetail | null {
  const ldM = html.match(/<script type="application\/ld\+json">([\s\S]*?"@type"\s*:\s*"JobPosting"[\s\S]*?)<\/script>/i)
  const ld = ldM ? ldM[1] : ""

  const h1 = html.match(/class="lis-container__header__hero__company-info__title"[^>]*>([\s\S]*?)<\/h1>/i)
  const title = (h1 ? clean(h1[1]) : "") || (ldField(ld, "title") ? clean(ldField(ld, "title")!) : "")
  if (!title) return null

  const orgM = ld.match(/"hiringOrganization"\s*:\s*\{([\s\S]*?)\}/)
  const company = orgM ? (ldField(orgM[1], "name") ? clean(ldField(orgM[1], "name")!) : null) : null
  const hq = orgM ? (ldField(orgM[1], "address") ? clean(ldField(orgM[1], "address")!) : null) : null

  const applicantCountries: string[] = []
  const alrM = ld.match(/"applicantLocationRequirements"\s*:\s*\[([\s\S]*?)\]/)
  if (alrM) {
    const nameRe = /"name"\s*:\s*"([^"]+)"/g
    let nm: RegExpExecArray | null
    while ((nm = nameRe.exec(alrM[1])) !== null) applicantCountries.push(nm[1])
  }

  // Sidebar "About the job" list: Posted on / Apply before / Job type / Category / Region|Country.
  const items: Record<string, string> = {}
  let regions: string[] = []
  const itemRe = /<li class="lis-container__job__sidebar__job-about__list__item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi
  let im: RegExpExecArray | null
  while ((im = itemRe.exec(html)) !== null) {
    const body = im[1]
    const label = clean(body.replace(/<div class="geolock-container">[\s\S]*?<\/div>/gi, "").split(/<(?:span|a|div)\b/i)[0])
    if (!label) continue
    if (/^(region|country|countries|regions)$/i.test(label)) {
      const boxRe = /<span class="box[^"]*"[^>]*>([\s\S]*?)<\/span>/gi
      let bm: RegExpExecArray | null
      while ((bm = boxRe.exec(body)) !== null) {
        const t = stripFlag(clean(bm[1]))
        if (t) regions.push(t)
      }
    } else {
      items[label.toLowerCase()] = clean(body.slice(body.search(/<(?:span|a)\b/i)))
    }
  }
  if (!regions.length) {
    const loc = ld.match(/"addressLocality"\s*:\s*"([^"]+)"/)
    if (loc) regions = [clean(loc[1])]
  }
  const region = regions.length ? regions.join(", ") : null

  const descHtml = extractDivContent(html, "lis-container__job__content__description")
  let description: string | null = descHtml ? htmlToText(descHtml) || null : null
  if (!description) {
    const d = ldField(ld, "description")
    if (d) description = htmlToText(decodeHtmlEntities(d.replace(/\\n/g, "\n"))) || null
  }

  let salary: string | null = null
  const min = ld.match(/"minValue"\s*:\s*"?([\d.]+)"?/)
  const max = ld.match(/"maxValue"\s*:\s*"?([\d.]+)"?/)
  const cur = ld.match(/"currency"\s*:\s*"([A-Z]{3})"/)
  if (min && max && Number(max[1]) > 0) salary = `${min[1]}-${max[1]} ${cur ? cur[1] : ""}`.trim()

  const validThrough = ldDate(ldField(ld, "validThrough"))
  // Scope the banner check to the page header: posting text can quote these phrases.
  const descStart = html.search(/lis-container__job__content__description/)
  const header = descStart === -1 ? html : html.slice(0, descStart)
  const expiredBanner = /this (?:job|position|listing) (?:has )?(?:expired|is no longer available|is closed)/i.test(
    clean(header),
  )
  const isActive = !expiredBanner && !(validThrough && Date.parse(validThrough) < Date.now())

  return {
    id,
    title,
    company,
    location: region,
    region,
    regions,
    applicantCountries,
    date: ldDate(ldField(ld, "datePosted")),
    validThrough,
    jobType: ldField(ld, "employmentType") ?? (items["job type"] || null),
    category: ldField(ld, "occupationalCategory") ?? (items["category"] || null),
    hq,
    salary,
    description,
    url: `${DETAIL_URL}/${id}`,
    isActive,
  }
}
