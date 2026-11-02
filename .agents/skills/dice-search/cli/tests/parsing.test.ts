// Offline parser tests against small synthetic pages shaped like Dice's live
// markup (verified 2026-11-01). No network.
import { describe, expect, test } from "bun:test"
import {
  parseSearchPage,
  parseJobDetail,
  normalizeId,
  workplaceFilter,
  postedDateFilter,
  filterByAge,
  htmlFetch,
  RETRY,
  type JobCard,
} from "../src/helpers.ts"
import { buildUrl } from "../src/commands/search.ts"

const G1 = "a7f7c2dd-df6c-48d3-85b5-c3afa257a72d"
const G2 = "986ffe3c-f94c-45a3-8996-da7445b42973"

function flightPage(flightText: string, splitAt = 60): string {
  // Dice splits the RSC payload across several push() calls; mimic that.
  const parts = [flightText.slice(0, splitAt), flightText.slice(splitAt)]
  return (
    "<html><body>" +
    parts.map((p) => `<script>self.__next_f.push([1,${JSON.stringify(p)}])</script>`).join("") +
    "</body></html>"
  )
}

const jobs = [
  {
    id: "cbf157ffe78b57890656df8eb5d9da29",
    guid: G1,
    detailsPageUrl: `https://www.dice.com/job-detail/${G1}`,
    companyName: "Spadtek Solutions LLC",
    employmentType: "Contract, Third Party",
    employerType: "Direct Hire",
    postedDate: "2026-10-28T15:36:28Z",
    salary: "Depends on Experience",
    summary: "Build SAP CPI &amp; ABAP integrations",
    title: "SAP Integration Developer (Mid-Level)",
    easyApply: true,
    isRemote: true,
    workplaceTypes: ["Remote"],
  },
  {
    id: "c6784c1dfa74bec5cef31100f288f74e",
    guid: G2,
    detailsPageUrl: `https://www.dice.com/job-detail/${G2}`,
    companyName: "Diversified Systems, Inc.",
    employmentType: "Full-time",
    postedDate: "2026-10-20T12:56:40Z",
    title: "EDI Developer",
    isRemote: false,
    workplaceTypes: ["Hybrid"],
    jobLocation: { city: "Atlanta", displayName: "Atlanta, Georgia, USA" },
  },
]

const flight =
  'f:["$","$L4e",null,{"jobList":{"data":[' +
  JSON.stringify(jobs[0]) +
  ',{"id":"broken","title":"no guid"},' +
  JSON.stringify(jobs[1]) +
  '],"meta":{"currentPage":2,"pageSize":30,"pageCount":9,"totalResults":259}}}]'

describe("parseSearchPage", () => {
  const parsed = parseSearchPage(flightPage(flight))

  test("finds the jobList and keeps only well-formed cards", () => {
    expect(parsed.found).toBe(true)
    expect(parsed.cards.map((c) => c.id)).toEqual([G1, G2])
  })

  test("maps fields, with nulls for missing values", () => {
    const [a, b] = parsed.cards
    expect(a.title).toBe("SAP Integration Developer (Mid-Level)")
    expect(a.company).toBe("Spadtek Solutions LLC")
    expect(a.location).toBeNull()
    expect(a.workplace).toEqual(["Remote"])
    expect(a.employmentType).toBe("Contract, Third Party")
    expect(a.date).toBe("2026-10-28T15:36:28Z")
    expect(a.url).toBe(`https://www.dice.com/job-detail/${G1}`)
    expect(a.summary).toBe("Build SAP CPI & ABAP integrations")
    expect(b.location).toBe("Atlanta, Georgia, USA")
    expect(b.workplace).toEqual(["Hybrid"])
    expect(b.salary).toBeNull()
    expect(b.employerType).toBeNull()
  })

  test("reads paging meta", () => {
    expect(parsed.meta).toEqual({ currentPage: 2, pageSize: 30, pageCount: 9, totalResults: 259 })
  })

  test("reports found=false when the page has no jobList", () => {
    expect(parseSearchPage("<html>blocked</html>").found).toBe(false)
  })
})

describe("filters", () => {
  test("--remote maps to filters.workplaceTypes values", () => {
    expect(workplaceFilter("remote")).toBe("Remote")
    expect(workplaceFilter("hybrid")).toBe("Hybrid")
    expect(workplaceFilter("onsite")).toBe("On-Site")
    expect(workplaceFilter("remote,hybrid")).toBeNull()
  })

  test("--jobage maps to Dice posted-date buckets", () => {
    expect(postedDateFilter(1)).toBe("ONE")
    expect(postedDateFilter(2)).toBe("THREE")
    expect(postedDateFilter(7)).toBe("SEVEN")
    expect(postedDateFilter(30)).toBeNull()
  })

  test("client-side age filter drops older and undated cards", () => {
    const now = Date.parse("2026-11-01T00:00:00Z")
    const mk = (date: string | null) => ({ id: "x", date }) as unknown as JobCard
    const out = filterByAge([mk("2026-10-30T00:00:00Z"), mk("2026-10-01T00:00:00Z"), mk(null)], 7, now)
    expect(out.length).toBe(1)
  })

  test("buildUrl carries query, workplace, posted date and page", () => {
    const url = buildUrl({ query: "integration developer", remote: "remote", jobage: 3, page: 2, format: "json" })
    expect(url).toBe(
      "https://www.dice.com/jobs?q=integration%20developer&filters.workplaceTypes=Remote&filters.postedDate=THREE&page=2",
    )
  })
})

describe("parseJobDetail", () => {
  const ld = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "SAP Integration Developer (Mid-Level)",
    description: "<p><strong>Job title:</strong> SAP Integration Developer<br />Location: LATAM</p><h2>Key Responsibilities</h2><ul><li>Build iFlows &amp; mappings</li><li>Write Groovy</li></ul><p>TSP&rsquo;s practice</p>",
    datePosted: "2026-10-28T15:36:28.000Z",
    validThrough: "2026-11-28T15:36:28.000Z",
    url: `https://www.dice.com/job-detail/${G1}`,
    hiringOrganization: { "@type": "Organization", name: "Spadtek Solutions LLC" },
    applicantLocationRequirements: { "@type": "Country", name: "USA" },
    jobLocationType: "TELECOMMUTE",
    employmentType: "CONTRACTOR",
    baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: "Depends on Experience" },
  }
  const badge = (t: string, testid?: string) =>
    `<div class="SeuiInfoBadge bg-surface-tertiary"${testid ? ` data-testid="${testid}"` : ""}><div class="font-medium">${t}</div></div>`
  const html =
    `<script type="application/ld+json" id="jobDetailStructuredData">${JSON.stringify(ld)}</script>` +
    `<div data-testid="job-detail-header-card"><div class="order-4">` +
    badge("Contract Corp To Corp") + badge("Contract W2") + badge("12 Months", "contractDurationBadge") +
    badge("No Travel Required") + badge("Remote", "locationTypeBadge") + badge("Depends on Experience") +
    `</div></div><img alt="Company Branding Image">` + badge("SAP HCM") +
    `<script>self.__next_f.push([1,${JSON.stringify('"skills":["SAP Cloud Integration","SAP HCM"]')}])</script>`

  const job = parseJobDetail(html, G1)

  test("reads JSON-LD fields", () => {
    expect(job.title).toBe("SAP Integration Developer (Mid-Level)")
    expect(job.company).toBe("Spadtek Solutions LLC")
    expect(job.employmentType).toBe("CONTRACTOR")
    expect(job.jobLocationType).toBe("TELECOMMUTE")
    expect(job.applicantLocation).toBe("USA")
    expect(job.salary).toBe("Depends on Experience")
    expect(job.location).toBeNull()
  })

  test("reads header badges, scoped to the header card", () => {
    expect(job.workplace).toBe("Remote")
    expect(job.contractDuration).toBe("12 Months")
    expect(job.employmentTypes).toEqual(["Contract Corp To Corp", "Contract W2"])
    expect(job.badges).not.toContain("SAP HCM")
    expect(job.skills).toEqual(["SAP Cloud Integration", "SAP HCM"])
  })

  test("description is decoded text with line and list breaks", () => {
    expect(job.description).toContain("Job title: SAP Integration Developer\nLocation: LATAM")
    expect(job.description).toContain("- Build iFlows & mappings\n- Write Groovy")
    expect(job.description).toContain("TSP’s practice")
    expect(job.description).not.toContain("<")
  })
})

describe("normalizeId", () => {
  test("accepts a GUID and dice.com detail URLs", () => {
    expect(normalizeId(G1)).toBe(G1)
    expect(normalizeId(`https://www.dice.com/job-detail/${G1}`)).toBe(G1)
    expect(normalizeId(`www.dice.com/job-detail/${G1}?searchlink=x`)).toBe(G1)
  })
  test("rejects other hosts and look-alikes", () => {
    expect(normalizeId(`https://evil.io/job-detail/${G1}`)).toBeNull()
    expect(normalizeId(`https://dice.com.evil.io/job-detail/${G1}`)).toBeNull()
    expect(normalizeId(`https://dice.com@evil.io/job-detail/${G1}`)).toBeNull()
    expect(normalizeId("cbf157ffe78b57890656df8eb5d9da29")).toBeNull()
  })
})

describe("htmlFetch backoff", () => {
  test("retries 429/503 then succeeds; 404 returns empty string", async () => {
    const saved = { ...RETRY }
    RETRY.baseDelayMs = 1
    RETRY.maxDelayMs = 2
    try {
      const statuses = [429, 503, 200]
      let calls = 0
      const fake = (async () => {
        const s = statuses[calls++]
        return new Response(s === 200 ? "ok" : "", { status: s })
      }) as unknown as typeof fetch
      expect(await htmlFetch("https://www.dice.com/x", fake)).toBe("ok")
      expect(calls).toBe(3)
      const notFound = (async () => new Response("", { status: 404 })) as unknown as typeof fetch
      expect(await htmlFetch("https://www.dice.com/x", notFound)).toBe("")
    } finally {
      Object.assign(RETRY, saved)
    }
  })
})
