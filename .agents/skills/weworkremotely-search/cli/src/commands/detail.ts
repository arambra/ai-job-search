import { DETAIL_URL, htmlFetch, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const WWR_HOST = /^(www\.)?weworkremotely\.com$/i
const SLUG = /^[a-z0-9][a-z0-9-]*$/i

/**
 * Accept a job slug from `search` (e.g. "legion-senior-integration-engineer")
 * or a weworkremotely.com /remote-jobs/<slug> URL (with or without scheme).
 * URLs on any other host are rejected, parsed through real URL parsing so
 * look-alike hosts and userinfo tricks fall on the reject side.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!WWR_HOST.test(parsed.hostname)) return null
    const m = parsed.pathname.match(/^\/remote-jobs\/([a-z0-9][a-z0-9-]*)\/?$/i)
    if (!m || m[1] === "search" || m[1] === "find-your-plan") return null
    return m[1].toLowerCase()
  }
  const path = trimmed.match(/^\/?remote-jobs\/([a-z0-9][a-z0-9-]*)\/?$/i)
  if (path) return path[1].toLowerCase()
  return SLUG.test(trimmed) ? trimmed.toLowerCase() : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a We Work Remotely job slug from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await htmlFetch(`${DETAIL_URL}/${id}`)
    const job = html ? parseJobDetail(html, id) : null
    if (!job) {
      writeError("Job not found (expired or removed)", "NOT_FOUND")
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "—"} · ${job.region || "—"}`,
        "",
        job.jobType ? `Job type: ${job.jobType}` : null,
        job.category ? `Category: ${job.category}` : null,
        `Region / eligibility: ${job.region || "—"}`,
        job.applicantCountries.length
          ? job.applicantCountries.length <= 30
            ? `Applicant countries (ISO): ${job.applicantCountries.join(", ")}`
            : `Applicant countries (ISO): ${job.applicantCountries.length} countries (full list in --format json)`
          : null,
        job.hq ? `HQ: ${job.hq}` : null,
        job.salary ? `Salary: ${job.salary}` : null,
        job.date ? `Posted: ${job.date}` : null,
        job.validThrough ? `Apply before: ${job.validThrough}` : null,
        `Status: ${job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l): l is string => l !== null)
      process.stdout.write(lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
