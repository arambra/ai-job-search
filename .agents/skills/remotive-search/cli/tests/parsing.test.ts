import { describe, expect, test } from "bun:test"
import {
  cleanHtml,
  contractDate,
  countryRule,
  isEligible,
  matchesCategory,
  matchesQuery,
  parseJobId,
  retryAfterMs,
  splitRegions,
  toResult,
  withinDays,
  type RemotiveJob,
  type RemotiveResponse,
} from "../src/helpers.ts"
import fixture from "./fixtures/remote-jobs.json"

const jobs = (fixture as unknown as RemotiveResponse).jobs

describe("cleanHtml", () => {
  test("strips tags, decodes entities, keeps paragraph breaks and bullets", () => {
    const out = cleanHtml("<p>We&rsquo;re hiring &amp; growing.</p><p>&nbsp;</p><ul><li>Go</li><li>Kubernetes</li></ul><p>Apply&#33;</p>")
    expect(out).toBe("We’re hiring & growing.\n\n- Go\n- Kubernetes\n\nApply!")
  })
  test("real fixture description has no tags or entities left", () => {
    const out = cleanHtml(jobs[0].description)!
    expect(out).not.toMatch(/<[a-z/][^>]*>/i)
    expect(out).not.toMatch(/&[a-z]+;|&#\d+;/i)
    expect(out.length).toBeGreaterThan(100)
  })
  test("null for empty", () => {
    expect(cleanHtml("")).toBeNull()
    expect(cleanHtml(null)).toBeNull()
  })
})

describe("country eligibility", () => {
  const ca = countryRule("Canada")
  const cases: Array<[string | null, boolean]> = [
    ["Worldwide", true],
    ["Anywhere in the world", true],
    ["USA, Canada, USA timezones", true],
    ["Europe, USA, Canada, APAC", true],
    ["North America", true],
    ["Americas", true],
    ["USA", false],
    ["Latin America", false],
    ["Europe", false],
    ["Worldwide except Canada", false],
    ["Anywhere outside the USA and Canada", false],
    ["", false],
    [null, false],
  ]
  for (const [loc, want] of cases) {
    test(`Canada vs ${JSON.stringify(loc)} -> ${want}`, () => expect(isEligible(loc, ca)).toBe(want))
  }
  test("country codes and aliases resolve", () => {
    expect(countryRule("ca").country).toBe("canada")
    expect(isEligible("US only", countryRule("usa"))).toBe(true)
    expect(isEligible("UK, EMEA", countryRule("United Kingdom"))).toBe(true)
    expect(isEligible("Germany", countryRule("Estonia"))).toBe(false)
    expect(isEligible("Estonia", countryRule("Estonia"))).toBe(true)
  })
})

describe("field shaping", () => {
  test("toResult carries contract fields with nulls, eligible_regions split", () => {
    const j = jobs.find((x) => x.id === 2069746)!
    const r = toResult(j)
    expect(r.id).toBe("2069746")
    expect(r.location).toBe("USA, Canada, USA timezones")
    expect(r.eligible_regions).toEqual(["USA", "Canada", "USA timezones"])
    expect(r.date).toBe("2026-10-14")
    expect(r.url).toStartWith("https://remotive.com/")
    expect(r.job_type).toBe("full-time")
    const bare = toResult({ ...j, salary: "", job_type: "", candidate_required_location: "" } as RemotiveJob, false)
    expect(bare.salary).toBeNull()
    expect(bare.job_type).toBeNull()
    expect(bare.location).toBeNull()
    expect(bare.eligible_regions).toEqual([])
    expect(bare.description).toBeNull()
  })
  test("splitRegions keeps multi-word country names", () => {
    expect(splitRegions("Trinidad and Tobago; Canada/USA")).toEqual(["Trinidad and Tobago", "Canada", "USA"])
  })
  test("contractDate", () => {
    expect(contractDate("2026-10-29T18:22:41")).toBe("2026-10-29")
    expect(contractDate("")).toBeNull()
  })
})

describe("client-side filters", () => {
  test("query is a whole-phrase partial match over title + description", () => {
    const j = jobs.find((x) => x.id === 2091135)!
    expect(matchesQuery(j, "back-end DEVELOPER")).toBe(true)
    expect(matchesQuery(j, "integration developer")).toBe(false)
    expect(matchesQuery(j, undefined)).toBe(true)
  })
  test("category matches name or slug", () => {
    const j = jobs.find((x) => x.id === 2091135)!
    expect(matchesCategory(j, "software-development")).toBe(true)
    expect(matchesCategory(j, "Software Development")).toBe(true)
    expect(matchesCategory(j, "writing")).toBe(false)
    expect(matchesCategory({ ...j, category: "Data and Analytics" }, "data")).toBe(true)
  })
  test("withinDays", () => {
    const j = { ...jobs[0], publication_date: "2026-10-29T00:00:00" }
    const now = Date.parse("2026-11-01T00:00:00Z")
    expect(withinDays(j, 3, now)).toBe(true)
    expect(withinDays(j, 2, now)).toBe(false)
  })
})

describe("parseJobId", () => {
  test("bare ids and remotive URLs", () => {
    expect(parseJobId("2091165")).toBe("2091165")
    expect(parseJobId("https://remotive.com/remote-jobs/software-development/full-stack-developer-2091165")).toBe("2091165")
    expect(parseJobId("remotive.com/remote-jobs/sales/inside-sales-contractor-2086540/")).toBe("2086540")
  })
  test("rejects other hosts and garbage", () => {
    expect(parseJobId("https://remotive.com.evil.io/remote-jobs/x-123")).toBeNull()
    expect(parseJobId("https://example.com/job-123")).toBeNull()
    expect(parseJobId("not an id")).toBeNull()
  })
})

test("retryAfterMs parses seconds and dates", () => {
  expect(retryAfterMs("30")).toBe(30_000)
  expect(retryAfterMs(null)).toBeNull()
  expect(retryAfterMs(new Date(10_000).toUTCString(), 0)).toBe(10_000)
})
