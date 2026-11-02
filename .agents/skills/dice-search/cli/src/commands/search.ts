import {
  SEARCH_URL,
  htmlFetch,
  parseSearchPage,
  workplaceFilter,
  postedDateFilter,
  filterByAge,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  location?: string
  jobage?: number
  remote?: string // "remote" | "hybrid" | "onsite"
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  params.set("q", opts.query)
  if (opts.location) params.set("location", opts.location)
  const wt = workplaceFilter(opts.remote)
  if (wt) params.set("filters.workplaceTypes", wt)
  const pd = postedDateFilter(opts.jobage)
  if (pd) params.set("filters.postedDate", pd)
  if (opts.page > 1) params.set("page", String(opts.page))
  // URLSearchParams encodes spaces as "+"; Dice's own links use %20.
  return `${SEARCH_URL}?${params.toString().replace(/\+/g, "%20")}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const header =
    "ID".padEnd(36) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(24) + " " +
    "WORKPLACE".padEnd(14) + " " + "TYPE".padEnd(22) + " " + "LOCATION".padEnd(20) + " DATE"
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "-").slice(0, 24).padEnd(24)
    const wp = (c.workplace?.join("/") || "-").slice(0, 14).padEnd(14)
    const type = (c.employmentType || "-").slice(0, 22).padEnd(22)
    const loc = (c.location || "-").slice(0, 20).padEnd(20)
    const date = c.date ? c.date.slice(0, 10) : "-"
    return `${c.id} ${title} ${company} ${wp} ${type} ${loc} ${date}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    if (!html) {
      writeError("Search page not found (404)", "NOT_FOUND")
      return 1
    }
    const parsed = parseSearchPage(html)
    if (!parsed.found) {
      writeError(
        "No job list found in the Dice search page - the page markup may have changed or the request was blocked",
        "PARSE_FAILED",
      )
      return 1
    }
    let cards = filterByAge(parsed.cards, opts.jobage)
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
                  `${c.title}\n  ${c.company || "-"} · ${c.location || "-"} · ${c.workplace?.join("/") || "-"} · ${c.employmentType || "-"} · ${c.date || "-"}\n  id: ${c.id}\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: cards.length,
              page: parsed.meta.currentPage ?? opts.page,
              pageSize: parsed.meta.pageSize,
              pageCount: parsed.meta.pageCount,
              totalResults: parsed.meta.totalResults,
            },
            results: cards,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
