import { apiGet, HttpError, parseJobRef, toDetail, unixToDate, writeError, type HimalayasJob, type JobDetailResult } from "../helpers.js"

export interface DetailOpts {
  id: string // `<company>/<slug>` or a himalayas.app job URL
  format: "json" | "plain"
}

/** The check-one-job endpoint for a parsed reference. */
export function detailPath(ref: { company: string; slug: string }): string {
  return `/jobs/api/companies/${encodeURIComponent(ref.company)}/jobs/${encodeURIComponent(ref.slug)}`
}

function renderPlain(job: JobDetailResult): string {
  const lines: string[] = [job.title, `${job.company ?? "-"} · ${job.location}`]
  const field = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`)
  }
  field("Eligible countries", job.worldwide ? "Worldwide (no country restriction)" : job.eligible_countries.join(", "))
  field("Timezones (UTC offsets)", job.timezones.length ? job.timezones.join(", ") : null)
  field("Posted/updated", job.date)
  field("Expires", job.expiry_date)
  field("Employment", job.employment_type)
  field("Seniority", job.seniority.length ? job.seniority.join(", ") : null)
  field("Salary", job.salary)
  field("Categories", job.categories.length ? job.categories.join(", ") : null)
  lines.push("", job.description ?? "(no description)", "", `URL: ${job.url}`)
  if (job.apply_url) lines.push(`Apply: ${job.apply_url}`)
  lines.push(`id: ${job.id}`)
  return lines.join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const ref = parseJobRef(opts.id)
  if (!ref) {
    writeError(
      `could not parse a Himalayas job from "${opts.id}" - pass a search result's id (<company>/<slug>) or a https://himalayas.app/companies/<company>/jobs/<slug> URL`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const body = await apiGet<{ job: HimalayasJob }>(detailPath(ref))
    if (!body || !body.job) {
      writeError("job not found", "NOT_FOUND")
      return 1
    }
    const job = toDetail(body.job)
    process.stdout.write((opts.format === "plain" ? renderPlain(job) : JSON.stringify(job, null, 2)) + "\n")
    return 0
  } catch (e) {
    if (e instanceof HttpError && e.status === 410) {
      const exp = (e.body as { expiryDate?: number } | null)?.expiryDate
      const when = unixToDate(exp)
      writeError(`job has closed${when ? ` (expired ${when})` : ""}`, "JOB_CLOSED")
      return 1
    }
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
