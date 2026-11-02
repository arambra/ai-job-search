// Offline command tests: the CLI is pointed at a local server that serves the
// recorded fixture, so the suite makes zero calls to Remotive (whose terms ask
// for at most a few requests a day). The single live call is in live.test.ts.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { join } from "path"
import { readFileSync } from "fs"
import type { CLIResult } from "./helpers.ts"

const CLI_PATH = join(import.meta.dir, "../src/cli.ts")
const FIXTURE = readFileSync(join(import.meta.dir, "fixtures/remote-jobs.json"), "utf8")

let server: ReturnType<typeof Bun.serve>
let hits = 0
let lastQuery = ""

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const u = new URL(req.url)
      if (u.pathname !== "/api/remote-jobs") return new Response("not found", { status: 404 })
      hits++
      lastQuery = u.search
      return new Response(FIXTURE, { headers: { "Content-Type": "application/json" } })
    },
  })
})
afterAll(() => server.stop(true))

async function run(args: string[]): Promise<CLIResult> {
  const proc = Bun.spawn(["bun", "run", CLI_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, REMOTIVE_API_URL: `http://localhost:${server.port}`, REMOTIVE_CACHE_TTL_MIN: "0" },
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

interface SearchOut {
  meta: { count: number; page: number; total: number }
  results: Array<Record<string, unknown>>
}

describe("search (fixture)", () => {
  test("one request with documented params, contract shape, nulls present", async () => {
    const before = hits
    const r = await run(["search", "-q", "developer", "--category", "software-development"])
    expect(r.exitCode).toBe(0)
    expect(hits - before).toBe(1)
    expect(lastQuery).toContain("search=developer")
    expect(lastQuery).toContain("category=software-development")
    expect(lastQuery).not.toContain("limit=")
    const out = JSON.parse(r.stdout) as SearchOut
    expect(out.meta.page).toBe(1)
    expect(out.meta.count).toBe(out.results.length)
    expect(out.results.length).toBeGreaterThan(0)
    for (const row of out.results) {
      for (const k of ["id", "title", "company", "location", "eligible_regions", "date", "url", "job_type", "salary", "description"]) {
        expect(row).toHaveProperty(k)
      }
      expect(row.category).toBe("Software Development")
    }
  })

  test("--country canada keeps Canada/worldwide jobs only", async () => {
    const r = await run(["search", "--country", "canada", "--no-description"])
    const out = JSON.parse(r.stdout) as SearchOut
    expect(out.results.length).toBe(5) // every fixture job admits Canada
    for (const row of out.results) expect(row.description).toBeNull()
    const de = JSON.parse((await run(["search", "--country", "germany"])).stdout) as SearchOut
    // Worldwide (3) + "Europe, ..." (1); the "USA, Canada" job is dropped.
    expect(de.results.map((x) => x.id)).not.toContain("2069746")
    expect(de.meta.total).toBe(4)
  })

  test("--page/--limit page client-side", async () => {
    const p1 = JSON.parse((await run(["search", "--limit", "2"])).stdout) as SearchOut
    const p3 = JSON.parse((await run(["search", "--limit", "2", "--page", "3"])).stdout) as SearchOut
    expect(p1.results.length).toBe(2)
    expect(p3.results.length).toBe(1)
    expect(p3.meta.page).toBe(3)
    expect(p1.meta.total).toBe(5)
  })

  test("table output names the source", async () => {
    const r = await run(["search", "--format", "table"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("ELIGIBLE LOCATION")
    expect(r.stdout).toContain("Source: Remotive")
  })
})

describe("detail (fixture)", () => {
  test("detail <id> --format plain prints readable text", async () => {
    const r = await run(["detail", "2091135", "--format", "plain"])
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain("Senior Back-end Developer")
    expect(r.stdout).toContain("Eligible: Europe, USA, Canada")
    expect(r.stdout).not.toMatch(/<\/?p>|&amp;/)
  })
  test("detail <url> json", async () => {
    const r = await run(["detail", "https://remotive.com/remote-jobs/software-development/full-stack-developer-2091165"])
    const d = JSON.parse(r.stdout) as Record<string, unknown>
    expect(d.id).toBe("2091165")
    expect(d.source).toContain("Remotive")
  })
  test("unknown id -> NOT_FOUND on stderr, exit 1", async () => {
    const r = await run(["detail", "999"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(JSON.parse(r.stderr).code).toBe("NOT_FOUND")
  })
})

describe("argument errors (no request)", () => {
  const cases: Array<[string[], string]> = [
    [["search", "--bogus", "x"], "UNKNOWN_FLAG"],
    [["search", "--limit", "0"], "BAD_ARG"],
    [["search", "--format", "xml"], "BAD_ARG"],
    [["search", "--country"], "BAD_ARG"],
    [["detail"], "NO_ID"],
    [["detail", "https://example.com/job-1"], "BAD_ID"],
    [["nope"], "BAD_CMD"],
  ]
  for (const [args, code] of cases) {
    test(`${args.join(" ")} -> ${code}`, async () => {
      const before = hits
      const r = await run(args)
      expect(r.exitCode).toBe(1)
      expect(r.stdout).toBe("")
      expect(JSON.parse(r.stderr).code).toBe(code)
      expect(hits).toBe(before)
    })
  }
})
