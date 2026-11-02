import {
  SOURCE,
  countryRule,
  fetchJobs,
  isEligible,
  matchesCategory,
  matchesCompany,
  matchesQuery,
  toResult,
  withinDays,
  writeError,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  category?: string
  company?: string
  country?: string
  jobage?: number
  page: number
  limit: number
  format: "json" | "table" | "plain"
  includeDescription: boolean
}

/**
 * One API request carrying the documented `search` / `category` / `company_name`
 * filters (no `limit`: the full matching set is needed to page client-side).
 * The same filters are then re-applied client-side - the public endpoint has
 * been observed ignoring them and returning its whole feed - followed by
 * --jobage, --country, --page and --limit.
 */
export function buildParams(opts: SearchOpts): URLSearchParams {
  const p = new URLSearchParams()
  if (opts.query) p.set("search", opts.query)
  if (opts.category) p.set("category", opts.category)
  if (opts.company) p.set("company_name", opts.company)
  return p
}

function cut(s: string, w: number): string {
  return s.length > w ? s.slice(0, w - 1) + "…" : s
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const cols: Array<{ h: string; w: number; v: (r: JobResult) => string }> = [
    { h: "ID", w: Math.max(2, ...rows.map((r) => r.id.length)), v: (r) => r.id },
    { h: "TITLE", w: 36, v: (r) => r.title },
    { h: "COMPANY", w: 22, v: (r) => r.company ?? "—" },
    { h: "ELIGIBLE LOCATION", w: 28, v: (r) => r.location ?? "—" },
    { h: "TYPE", w: 10, v: (r) => r.job_type ?? "—" },
    { h: "SALARY", w: 20, v: (r) => r.salary ?? "—" },
    { h: "DATE", w: 10, v: (r) => r.date ?? "—" },
  ]
  const line = (cells: string[]) => cells.map((c, i) => cut(c, cols[i].w).padEnd(cols[i].w)).join("  ").trimEnd()
  const header = line(cols.map((c) => c.h))
  return [header, "-".repeat(header.length), ...rows.map((r) => line(cols.map((c) => c.v(r))))].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  return rows
    .map((r) =>
      [
        r.title,
        `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${r.date ?? "—"}`,
        `  type: ${r.job_type ?? "—"} · salary: ${r.salary ?? "—"} · category: ${r.category ?? "—"}`,
        `  id: ${r.id}`,
        `  ${r.url}`,
      ].join("\n"),
    )
    .join("\n\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  let body
  try {
    body = await fetchJobs(buildParams(opts))
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "FETCH_FAILED")
    return 1
  }
  if (!body) {
    writeError("Remotive API endpoint not found (404)", "NOT_FOUND")
    return 1
  }

  const rule = opts.country ? countryRule(opts.country) : null
  const matched = body.jobs.filter(
    (j) =>
      matchesQuery(j, opts.query) &&
      matchesCategory(j, opts.category) &&
      matchesCompany(j, opts.company) &&
      withinDays(j, opts.jobage) &&
      (!rule || isEligible(j.candidate_required_location, rule)),
  )
  const start = (opts.page - 1) * opts.limit
  const rows = matched.slice(start, start + opts.limit).map((j) => toResult(j, opts.includeDescription))

  if (opts.format === "json") {
    const out = {
      meta: {
        count: rows.length,
        page: opts.page,
        total: matched.length,
        feed_size: body.jobs.length,
        country: rule?.country ?? null,
        source: SOURCE,
      },
      results: rows,
    }
    process.stdout.write(JSON.stringify(out, null, 2) + "\n")
  } else {
    const text = opts.format === "table" ? renderTable(rows) : renderPlain(rows)
    process.stdout.write(`${text}\n\n${matched.length} matching of ${body.jobs.length} in feed · Source: ${SOURCE}\n`)
  }
  return 0
}
