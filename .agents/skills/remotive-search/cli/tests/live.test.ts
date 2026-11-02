// The one live smoke test: a single real request to Remotive's public API
// (its terms ask for at most a few calls a day, so keep it to this one).
// Query "developer" rather than "integration developer": Remotive's public feed
// is small, and the niche phrase routinely matches nothing.
// Set REMOTIVE_SKIP_LIVE=1 to skip it.
import { expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers.ts"

const skip = process.env.REMOTIVE_SKIP_LIVE === "1"

test.skipIf(skip)("live search returns >=1 result with id/title/url", async () => {
  const prev = process.env.REMOTIVE_CACHE_TTL_MIN
  process.env.REMOTIVE_CACHE_TTL_MIN = "0" // force a real request; Bun.spawn inherits env
  try {
    const out = parseJSON<{ meta: { count: number }; results: Array<{ id: string; title: string; url: string }> }>(
      await runCLI(["search", "-q", "developer", "--limit", "3", "--no-description"]),
    )
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const r of out.results) {
      expect(r.id).toBeTruthy()
      expect(r.title).toBeTruthy()
      expect(r.url).toStartWith("https://remotive.com/")
    }
  } finally {
    if (prev === undefined) delete process.env.REMOTIVE_CACHE_TTL_MIN
    else process.env.REMOTIVE_CACHE_TTL_MIN = prev
  }
})
