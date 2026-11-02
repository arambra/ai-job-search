import {
  DETAIL_URL,
  htmlFetch,
  isExpiredUrl,
  parseJobDetail,
  postingUrl,
  writeError,
  type JobDetail,
} from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

// Job Bank's English and French hosts serve the same posting IDs.
const JOBBANK_HOST = /(^|\.)(jobbank\.gc\.ca|guichetemplois\.gc\.ca)$/i

/**
 * Accept a bare numeric posting ID or a Job Bank posting URL
 * (https://www.jobbank.gc.ca/jobsearch/jobposting/50495396, with or without
 * scheme, ;jsessionid=... or ?source=...). URLs on any other host are
 * rejected, so an employer's own apply link never fetches an unrelated
 * Job Bank posting that happens to share the number.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{5,10}$/.test(trimmed)) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!JOBBANK_HOST.test(parsed.hostname)) return null
    const m = parsed.pathname.match(/\/jobposting\/(\d{5,10})(?:;[^/]*)?\/?$/)
    return m ? m[1] : null
  }
  return null
}

function expiredDetail(id: string): JobDetail {
  return {
    id,
    title: "(expired)",
    company: null,
    location: null,
    date: null,
    url: postingUrl(id),
    workplace: null,
    workplaceLabel: null,
    salary: null,
    employmentType: null,
    startDate: null,
    vacancies: null,
    source: null,
    sourceJobNumber: null,
    applyUrl: null,
    deadline: null,
    description: null,
    isActive: false,
  }
}

export function renderPlain(job: JobDetail): string {
  const BLANK = ""
  const lines: Array<string | null> = [
    job.title,
    `${job.company || "—"} · ${job.location || "—"}`,
    BLANK,
    job.workplaceLabel ? `Work location: ${job.workplaceLabel}${job.workplace ? ` (${job.workplace})` : ""}` : null,
    job.salary ? `Salary: ${job.salary}` : null,
    job.employmentType ? `Employment: ${job.employmentType}` : null,
    job.startDate ? `Start: ${job.startDate}` : null,
    job.vacancies ? `Vacancies: ${job.vacancies}` : null,
    job.date ? `Posted: ${job.date}` : null,
    job.deadline ? `Advertised until: ${job.deadline}` : null,
    job.source ? `Source: ${job.source}${job.sourceJobNumber ? ` #${job.sourceJobNumber}` : ""}` : null,
    `Status: ${job.isActive ? "ACTIVE" : "CLOSED / EXPIRED"}`,
    BLANK,
    job.description || "(no description)",
    BLANK,
    job.applyUrl ? `Apply / full posting: ${job.applyUrl}` : null,
    `URL: ${job.url}`,
  ]
  return lines.filter((l): l is string => l !== null).join("\n")
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a Job Bank posting ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const { body, url, status } = await htmlFetch(`${DETAIL_URL}/${id}`)
    let job: JobDetail
    if (isExpiredUrl(url) || status === 410) {
      job = expiredDetail(id)
    } else if (!body) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    } else {
      job = parseJobDetail(body, id)
    }

    if (opts.format === "plain") {
      process.stdout.write(renderPlain(job) + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
