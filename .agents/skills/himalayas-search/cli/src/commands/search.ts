import { apiGet, HttpError, toResult, writeError, type JobResult, type SearchResponse } from "../helpers.js"

// The filtered search endpoint (20 jobs per page, `page` 1-based, no cursor).
export const SEARCH_PATH = "/jobs/api/search"

export const SENIORITIES = ["Entry-level", "Mid-level", "Senior", "Manager", "Director", "Executive"] as const
export const EMPLOYMENT_TYPES = ["Full Time", "Part Time", "Contractor", "Temporary", "Intern", "Volunteer", "Other"] as const
export const SORTS = ["relevant", "recent", "salaryAsc", "salaryDesc", "nameAToZ", "nameZToA", "jobs"] as const

export interface SearchOpts {
  query?: string
  jobage?: number // client-side, on pubDate
  page: number
  limit: number // client-side cap (the API always serves up to 20 per page)
  format: "json" | "table" | "plain"
  country?: string
  worldwide?: boolean
  excludeWorldwide?: boolean
  seniority: string[] // canonical values
  employmentType: string[] // canonical values
  company?: string
  timezone?: string
  sort?: string
}

export function buildQuery(opts: SearchOpts): URLSearchParams {
  const p = new URLSearchParams()
  if (opts.query) p.set("q", opts.query)
  if (opts.country) p.set("country", opts.country)
  if (opts.worldwide) p.set("worldwide", "true")
  if (opts.excludeWorldwide) p.set("exclude_worldwide", "true")
  if (opts.seniority.length) p.set("seniority", opts.seniority.join(","))
  if (opts.employmentType.length) p.set("employment_type", opts.employmentType.join(","))
  if (opts.company) p.set("company", opts.company)
  if (opts.timezone) p.set("timezone", opts.timezone)
  // --jobage filters client-side on pubDate, so it works best on the newest
  // jobs first: default the sort to `recent` when the caller set none.
  const sort = opts.sort ?? (opts.jobage ? "recent" : undefined)
  if (sort) p.set("sort", sort)
  if (opts.page > 1) p.set("page", String(opts.page))
  return p
}

/** Keep jobs whose pubDate (last update) is within `days` days of `now`. */
export function withinDays(r: JobResult, days: number, now = Date.now()): boolean {
  if (!r.date) return false
  const cutoff = now - days * 86_400_000
  return Date.parse(`${r.date}T23:59:59Z`) >= cutoff
}

interface Column {
  header: string
  width: number
  cell: (r: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "ID", width: Math.max(2, ...rows.map((r) => r.id.length)), cell: (r) => r.id },
    { header: "TITLE", width: 40, cell: (r) => r.title },
    { header: "COMPANY", width: 22, cell: (r) => r.company ?? "-" },
    { header: "ELIGIBLE", width: 30, cell: (r) => r.location.replace(/^Remote \((.*)\)$/, "$1") },
    { header: "SALARY", width: 26, cell: (r) => r.salary ?? "-" },
    { header: "DATE", width: 10, cell: (r) => r.date ?? "-" },
  ]
  const row = (cells: string[]) =>
    cells
      .map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width))
      .join("  ")
      .trimEnd()
  const header = row(columns.map((c) => c.header))
  return [header, "-".repeat(header.length), ...rows.map((r) => row(columns.map((c) => c.cell(r))))].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.company ?? "-"} · ${r.location} · ${r.date ?? "-"}`,
        `  ${[r.employment_type, r.seniority.join("/") || null, r.salary].filter(Boolean).join(" · ") || "-"}`,
        `  id: ${r.id}`,
        `  ${r.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const body = await apiGet<SearchResponse>(`${SEARCH_PATH}?${buildQuery(opts).toString()}`)
    if (!body) {
      writeError(`${SEARCH_PATH} not found - the Himalayas API may have moved; check https://himalayas.app/api`, "SEARCH_FAILED")
      return 1
    }
    const all = (body.jobs ?? []).map(toResult)
    let rows = opts.jobage ? all.filter((r) => withinDays(r, opts.jobage as number)) : all
    rows = rows.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: rows.length,
              page: opts.page,
              total: body.totalCount ?? null, // API estimate, may be a day old
              page_size: all.length,
            },
            results: rows,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    const code = e instanceof HttpError && e.status === 400 ? "BAD_ARG" : "SEARCH_FAILED"
    writeError(e instanceof Error ? e.message : String(e), code)
    return 1
  }
}
