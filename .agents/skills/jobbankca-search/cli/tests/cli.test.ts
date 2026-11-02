// CLI contract tests. The validation cases exit before any request is made;
// the single live smoke test hits jobbank.gc.ca once (the CLI itself spaces
// requests >= 5 s apart per robots.txt Crawl-delay).
import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers"

function expectJsonError(r: { stdout: string; stderr: string; exitCode: number }, code: string) {
  expect(r.exitCode).toBe(1)
  expect(r.stdout).toBe("")
  const err = JSON.parse(r.stderr)
  expect(err.code).toBe(code)
  expect(typeof err.error).toBe("string")
}

describe("argument validation (offline)", () => {
  test("unknown flag exits 1 with a JSON error on stderr", async () => {
    expectJsonError(await runCLI(["search", "-q", "edi", "--bogus", "x"]), "UNKNOWN_FLAG")
  })

  test("detail without an id exits 1", async () => {
    expectJsonError(await runCLI(["detail"]), "NO_ID")
  })

  test("detail with a non-Job Bank URL exits 1", async () => {
    expectJsonError(await runCLI(["detail", "https://ca.indeed.com/viewjob?jk=123456"]), "BAD_ID")
  })

  test("search with no filter at all exits 1", async () => {
    expectJsonError(await runCLI(["search"]), "NO_FILTER")
  })

  test("bad --remote mode exits 1", async () => {
    expectJsonError(await runCLI(["search", "-q", "edi", "--remote", "anywhere"]), "BAD_ARG")
  })

  test("non-integer --jobage exits 1", async () => {
    expectJsonError(await runCLI(["search", "-q", "edi", "--jobage", "0.5"]), "BAD_ARG")
  })

  test("empty --query exits 1", async () => {
    expectJsonError(await runCLI(["search", "-q", ""]), "BAD_ARG")
  })

  test("bad --format exits 1", async () => {
    expectJsonError(await runCLI(["search", "-q", "edi", "--format", "xml"]), "BAD_ARG")
  })
})

describe("live smoke test", () => {
  test("search 'integration developer' returns results with id/title/url", async () => {
    const r = await runCLI(["search", "-q", "integration developer", "--limit", "5"])
    const data = parseJSON<{
      meta: { count: number; page: number }
      results: Array<Record<string, unknown>>
    }>(r)
    expect(data.meta.page).toBe(1)
    expect(data.meta.count).toBeGreaterThanOrEqual(1)
    expect(data.results.length).toBe(data.meta.count)
    for (const job of data.results) {
      for (const key of ["id", "title", "company", "location", "date", "url", "workplace"]) {
        expect(key in job).toBe(true)
      }
      expect(job.id).toBeTruthy()
      expect(job.title).toBeTruthy()
      expect(String(job.url)).toMatch(/^https:\/\/www\.jobbank\.gc\.ca\/jobsearch\/jobposting\/\d+$/)
    }
  })
})
