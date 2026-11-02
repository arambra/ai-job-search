import {
  CATEGORY_URL,
  SEARCH_URL,
  htmlFetch,
  isEligible,
  matchesExact,
  parseJobCards,
  resolveCategory,
  writeError,
  type JobCard,
} from "../helpers.js"

export const PAGE_SIZE = 25

export interface SearchOpts {
  query?: string
  category?: string // short key or full slug, already validated by cli.ts
  jobage?: number
  eligible?: string
  exact: boolean
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

/**
 * One request per search:
 *  - with --query: /remote-jobs/search?term=<q> (server-side substring match on
 *    title/company; all matches come back on one page). --category then filters
 *    the cards client-side by their data-category id.
 *  - with only --category: /categories/<slug> (every active job in the category).
 */
export function buildUrl(opts: Pick<SearchOpts, "query" | "category">): string {
  if (opts.query) {
    const params = new URLSearchParams({ term: opts.query })
    return `${SEARCH_URL}?${params.toString()}`
  }
  const cat = resolveCategory(opts.category ?? "")
  if (!cat) throw new Error(`unknown category "${opts.category}"`)
  return `${CATEGORY_URL}/${cat.slug}`
}

export function filterCards(cards: JobCard[], opts: SearchOpts): JobCard[] {
  let out = cards
  if (opts.query && opts.category) {
    const cat = resolveCategory(opts.category)
    if (cat) out = out.filter((c) => c.categoryId === cat.id)
  }
  if (opts.query && opts.exact) out = out.filter((c) => matchesExact(c, opts.query!))
  if (opts.jobage !== undefined) out = out.filter((c) => c.ageDays !== null && c.ageDays <= opts.jobage!)
  if (opts.eligible) out = out.filter((c) => isEligible(c.regions, opts.eligible!))
  return out
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  // The id column is never truncated: it is what gets passed to `detail`.
  const idWidth = Math.max(2, ...cards.map((c) => c.id.length))
  const header =
    "ID".padEnd(idWidth) + " " + "TITLE".padEnd(40) + " " + "COMPANY".padEnd(22) + " " + "REGION".padEnd(26) + " DATE"
  const rows = cards.map((c) => {
    const id = c.id.padEnd(idWidth)
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "—").slice(0, 22).padEnd(22)
    const region = (c.region || "—").slice(0, 26).padEnd(26)
    return `${id} ${title} ${company} ${region} ${c.date || "—"}`
  })
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const html = await htmlFetch(buildUrl(opts))
    const all = filterCards(parseJobCards(html), opts)
    const start = (opts.page - 1) * PAGE_SIZE
    let cards = all.slice(start, start + PAGE_SIZE)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        (cards.length === 0
          ? "No results."
          : cards
              .map(
                (c) =>
                  `${c.title}\n  ${c.company || "—"} · ${c.region || "—"} · ${c.jobType || "—"} · ${c.date || "—"} (${c.age || "?"})\n  id: ${c.id}\n  ${c.url}`,
              )
              .join("\n\n")) + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          { meta: { count: cards.length, page: opts.page, total: all.length, pageSize: PAGE_SIZE }, results: cards },
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
