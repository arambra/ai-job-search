import {
  CITY_SUGGEST_URL,
  SEARCH_URL,
  htmlFetch,
  jobageToFage,
  parseCitySuggest,
  parseJobCards,
  parseTotal,
  provinceCode,
  workplaceParams,
  writeError,
  type JobCard,
  type Workplace,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  remote?: Workplace
  jobage?: number
  page: number
  limit?: number
  format: "json" | "table" | "plain"
  /** Injected for tests: "today" as YYYY-MM-DD for the client-side --jobage filter. */
  today?: string
}

export type ResolvedLocation =
  | { kind: "province"; code: string }
  | { kind: "city"; cityId: string; label: string }

/**
 * Resolve --location. A province/territory (code or name) maps straight to the
 * `fprov` facet. Anything else is treated as "City" or "City, PR" and resolved
 * to Job Bank's numeric city_id through the site's own city-suggest endpoint;
 * the search page ignores a free-text `locationstring` unless it is paired
 * with that id in `locationparam`.
 */
export async function resolveLocation(location: string): Promise<ResolvedLocation | null> {
  const prov = provinceCode(location)
  if (prov) return { kind: "province", code: prov }
  const [cityPart, provPart] = location.split(",").map((s) => s.trim())
  if (!cityPart) return null
  const wantProv = provPart ? provinceCode(provPart) : null
  if (provPart && !wantProv) return null
  const params = new URLSearchParams({ q: cityPart, fq: "NOT postalcode_cnt:0", wt: "json", rows: "25" })
  const { body } = await htmlFetch(`${CITY_SUGGEST_URL}?${params.toString()}`, "application/json")
  const match = parseCitySuggest(body, cityPart, wantProv)
  if (!match) return null
  return { kind: "city", cityId: match.cityId, label: `${match.name}, ${match.province}` }
}

export function buildUrl(opts: SearchOpts, loc: ResolvedLocation | null): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("searchstring", opts.query)
  if (loc?.kind === "city") {
    params.set("locationstring", loc.label)
    params.set("locationparam", loc.cityId)
  }
  if (loc?.kind === "province") params.append("fprov", loc.code)
  for (const v of workplaceParams(opts.remote)) params.append("fskl", v)
  const fage = jobageToFage(opts.jobage)
  if (fage) params.set("fage", fage)
  params.set("sort", "D") // newest first
  params.set("page", String(opts.page))
  return `${SEARCH_URL}?${params.toString()}`
}

function isoDaysAgo(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function localToday(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(9) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(28) + " " +
    "LOCATION".padEnd(22) + " " + "WORKPLACE".padEnd(9) + " DATE"
  const rows = cards.map((c) =>
    [
      c.id.padEnd(9),
      (c.title || "").slice(0, 40).padEnd(40),
      (c.company || "—").slice(0, 28).padEnd(28),
      (c.location || "—").slice(0, 22).padEnd(22),
      (c.workplace || "—").padEnd(9),
      c.date || "—",
    ].join(" "),
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    let loc: ResolvedLocation | null = null
    if (opts.location) {
      loc = await resolveLocation(opts.location)
      if (!loc) {
        writeError(
          `Job Bank does not recognise the location "${opts.location}" - pass a province/territory (e.g. "ON", "Ontario") or a Canadian city (e.g. "Toronto", "Toronto, ON")`,
          "BAD_LOCATION",
        )
        return 1
      }
    }
    const { body } = await htmlFetch(buildUrl(opts, loc))
    let cards = parseJobCards(body)
    const total = parseTotal(body)

    if (opts.jobage) {
      const cutoff = isoDaysAgo(opts.today ?? localToday(), opts.jobage)
      cards = cards.filter((c) => !c.date || c.date >= cutoff)
    }
    if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (cards.length === 0
          ? "No results."
          : cards
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.workplace || "—"} · ${c.date || "—"}\n  id: ${c.id}\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page, total }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
