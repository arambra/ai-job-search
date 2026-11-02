import { DETAIL_URL, htmlFetch, normalizeId, parseJobDetail, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(
      `Could not parse a Dice job id from "${opts.id}" - pass the UUID from search results or a https://www.dice.com/job-detail/<uuid> URL`,
      "BAD_ID",
    )
    return 1
  }
  try {
    const html = await htmlFetch(`${DETAIL_URL}/${id}`)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = parseJobDetail(html, id)
    if (!job.title && !job.description) {
      writeError(
        "No job posting data found on the page - the posting may have expired or the markup changed",
        "NOT_FOUND",
      )
      return 1
    }

    if (opts.format === "plain") {
      const lines = [
        job.title || "(untitled)",
        `${job.company || "-"} · ${job.location || job.applicantLocation || "-"}`,
        job.workplace ? `Workplace: ${job.workplace}` : "",
        job.employmentTypes.length
          ? `Employment: ${job.employmentTypes.join(", ")}`
          : job.employmentType
            ? `Employment: ${job.employmentType}`
            : "",
        job.contractDuration ? `Duration: ${job.contractDuration}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.applicantLocation ? `Applicant location: ${job.applicantLocation}` : "",
        job.date ? `Posted: ${job.date}` : "",
        job.validThrough ? `Valid through: ${job.validThrough}` : "",
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
      ].filter((l) => l !== "")
      const out = [lines.join("\n"), job.description || "(no description)", `URL: ${job.url}`]
      process.stdout.write(out.join("\n\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}
