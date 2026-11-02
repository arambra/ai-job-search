// CLI tests. The flag-validation tests never touch the network; the live
// smoke test makes exactly one search request and one detail request.
import { describe, expect, test } from "bun:test"
import { runCLI, parseJSON } from "./helpers"

function expectJsonError(r: { exitCode: number; stdout: string; stderr: string }, code: string) {
  expect(r.exitCode).toBe(1)
  expect(r.stdout).toBe("")
  const err = JSON.parse(r.stderr)
  expect(err.code).toBe(code)
  expect(typeof err.error).toBe("string")
}

describe("flag validation (offline)", () => {
  test("missing --query exits 1 with JSON error", async () => {
    expectJsonError(await runCLI(["search"]), "NO_QUERY")
  })
  test("bogus flag exits 1", async () => {
    expectJsonError(await runCLI(["search", "-q", "edi", "--bogus", "1"]), "UNKNOWN_FLAG")
  })
  test("bad --remote exits 1", async () => {
    expectJsonError(await runCLI(["search", "-q", "edi", "--remote", "remote,hybrid"]), "BAD_ARG")
  })
  test("bad --jobage exits 1", async () => {
    expectJsonError(await runCLI(["search", "-q", "edi", "--jobage", "0.5"]), "BAD_ARG")
  })
  test("bad --format exits 1", async () => {
    expectJsonError(await runCLI(["search", "-q", "edi", "--format", "xml"]), "BAD_ARG")
  })
  test("detail without id exits 1", async () => {
    expectJsonError(await runCLI(["detail"]), "NO_ID")
  })
  test("detail with a non-Dice URL exits 1", async () => {
    expectJsonError(
      await runCLI(["detail", "https://evil.io/job-detail/a7f7c2dd-df6c-48d3-85b5-c3afa257a72d"]),
      "BAD_ID",
    )
  })
})

interface SearchOut {
  meta: { count: number; page: number }
  results: Array<Record<string, unknown> & { id: string; title: string; url: string }>
}

describe("live smoke test (2 requests)", () => {
  test("search returns remote results, and detail reads one", async () => {
    const out = parseJSON<SearchOut>(
      await runCLI(["search", "-q", "integration developer", "--remote", "remote", "--limit", "3"]),
    )
    expect(out.meta.page).toBe(1)
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(r.title).toBeTruthy()
      expect(r.url).toStartWith("https://www.dice.com/job-detail/")
      for (const k of ["company", "location", "date", "workplace", "employmentType"]) expect(k in r).toBe(true)
      if (r.workplace !== null) expect(r.workplace as string[]).toContain("Remote")
    }

    const detail = parseJSON<Record<string, unknown>>(await runCLI(["detail", out.results[0].url]))
    expect(detail.id).toBe(out.results[0].id)
    expect(typeof detail.title).toBe("string")
    expect(typeof detail.description).toBe("string")
    expect((detail.description as string).length).toBeGreaterThan(50)
  }, 60000)
})
