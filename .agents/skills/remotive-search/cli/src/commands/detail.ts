import { SOURCE, fetchJobs, findCachedJob, parseJobId, toDetail, writeError, type JobDetailResult } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

function renderPlain(d: JobDetailResult): string {
  return [
    d.title,
    `Company:  ${d.company ?? "—"}`,
    `Eligible: ${d.location ?? "—"}`,
    `Type:     ${d.job_type ?? "—"}`,
    `Salary:   ${d.salary ?? "—"}`,
    `Category: ${d.category ?? "—"}`,
    `Posted:   ${d.date ?? "—"}`,
    `Tags:     ${d.tags.length ? d.tags.join(", ") : "—"}`,
    `URL:      ${d.url}`,
    `Source:   ${SOURCE}`,
    "",
    d.description ?? "(no description)",
  ].join("\n")
}

/**
 * Resolve one posting from a single API call: the public API has no per-id
 * endpoint, and the HTML job pages are robots-disallowed, so `detail` fetches
 * the job list (served from the shared on-disk cache when fresh) and picks the id.
 */
export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = parseJobId(opts.id)
  if (!id) {
    writeError(`"${opts.id}" is not a Remotive job id or a remotive.com job URL`, "BAD_ID")
    return 1
  }
  let job = findCachedJob(id)
  if (!job) {
    let body
    try {
      body = await fetchJobs(new URLSearchParams())
    } catch (e) {
      writeError(e instanceof Error ? e.message : String(e), "FETCH_FAILED")
      return 1
    }
    job = body?.jobs.find((j) => String(j.id) === id) ?? null
  }
  if (!job) {
    writeError(
      `job ${id} not found in Remotive's public API feed (it only lists active jobs, delayed 24h; the posting may have closed)`,
      "NOT_FOUND",
    )
    return 1
  }
  const d = toDetail(job)
  process.stdout.write(opts.format === "json" ? JSON.stringify(d, null, 2) + "\n" : renderPlain(d) + "\n")
  return 0
}
