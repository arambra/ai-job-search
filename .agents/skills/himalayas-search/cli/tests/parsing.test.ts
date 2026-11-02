import { afterEach, describe, expect, test } from "bun:test";
import {
  cleanHtml,
  decodeHtmlEntities,
  formatLocation,
  formatSalary,
  parseJobRef,
  retryAfterMs,
  toResult,
  unixToDate,
  type HimalayasJob,
} from "../src/helpers";
import { buildQuery, runSearch, withinDays, type SearchOpts } from "../src/commands/search";
import { runDetail } from "../src/commands/detail";

function job(overrides: Partial<HimalayasJob> = {}): HimalayasJob {
  return {
    title: "Integration Developer",
    excerpt: "Build integrations.",
    companyName: "H&amp;H Group",
    companySlug: "hh-group",
    employmentType: "Full Time",
    minSalary: 90000,
    maxSalary: 120000,
    salaryPeriod: "annual",
    seniority: ["Mid-level"],
    currency: "CAD",
    locationRestrictions: ["Canada"],
    timezoneRestrictions: [-5, -4],
    categories: ["Integration-Developer"],
    description: "<p>Hello &amp; welcome</p><ul><li>EDI</li><li>X12</li></ul>",
    pubDate: 1792004190,
    expiryDate: 1797188189,
    applicationLink: "https://himalayas.app/companies/hh-group/jobs/integration-developer?utm_source=api",
    guid: "https://himalayas.app/companies/hh-group/jobs/integration-developer",
    ...overrides,
  };
}

function opts(o: Partial<SearchOpts> = {}): SearchOpts {
  return { page: 1, limit: 20, format: "json", seniority: [], employmentType: [], ...o };
}

const originalFetch = globalThis.fetch;
const originalOut = process.stdout.write;
const originalErr = process.stderr.write;
afterEach(() => {
  globalThis.fetch = originalFetch;
  process.stdout.write = originalOut;
  process.stderr.write = originalErr;
});

function capture(stream: "stdout" | "stderr"): () => string {
  let buf = "";
  process[stream].write = ((c: string | Uint8Array) => {
    buf += c.toString();
    return true;
  }) as typeof process.stdout.write;
  return () => buf;
}

function mockFetch(status: number, body: unknown): () => string {
  let url = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => url;
}

describe("toResult", () => {
  test("maps the contract fields and eligibility, never omitting nulls", () => {
    const r = toResult(job());
    expect(r.id).toBe("hh-group/integration-developer");
    expect(r.company).toBe("H&H Group");
    expect(r.location).toBe("Remote (Canada)");
    expect(r.eligible_countries).toEqual(["Canada"]);
    expect(r.worldwide).toBe(false);
    expect(r.date).toBe("2026-10-14");
    expect(r.url).toBe("https://himalayas.app/companies/hh-group/jobs/integration-developer");
    expect(r.salary).toBe("CAD 90000-120000/annual");
    const bare = toResult(job({ companyName: null, minSalary: null, maxSalary: null, locationRestrictions: [] }));
    expect(bare.company).toBeNull();
    expect(bare.salary).toBeNull();
    expect(bare.salary_period).toBeNull();
    expect(bare.worldwide).toBe(true);
    expect(bare.location).toBe("Remote (Worldwide)");
    expect("company" in bare).toBe(true);
  });

  test("long country lists are abbreviated in location but kept whole in eligible_countries", () => {
    const list = ["Canada", "Mexico", "Brazil", "Chile", "Peru", "United States"];
    expect(formatLocation(list)).toBe("Remote (Canada, Mexico, Brazil, Chile +2 more)");
    expect(toResult(job({ locationRestrictions: list })).eligible_countries).toHaveLength(6);
  });
});

describe("helpers", () => {
  test("unixToDate", () => {
    expect(unixToDate(0)).toBeNull();
    expect(unixToDate(null)).toBeNull();
    expect(unixToDate(1793539125)).toBe("2026-11-01");
  });
  test("formatSalary single bound and default period", () => {
    expect(formatSalary(job({ minSalary: 50, maxSalary: null, salaryPeriod: "hourly", currency: "USD" }))).toBe("USD 50/hourly");
    expect(formatSalary(job({ salaryPeriod: null }))).toBe("CAD 90000-120000/annual");
  });
  test("cleanHtml produces readable text with bullets", () => {
    expect(cleanHtml(job().description)).toBe("Hello & welcome\n\n- EDI\n- X12");
    expect(cleanHtml("")).toBeNull();
  });
  test("decodeHtmlEntities decodes &amp; last (no double decode)", () => {
    expect(decodeHtmlEntities("a &amp;lt; b &#8217;")).toBe("a &lt; b ’");
  });
  test("retryAfterMs", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(null)).toBeNull();
  });
  test("parseJobRef accepts ids, guid, apply link and api URL; rejects other hosts", () => {
    const want = { company: "linear", slug: "senior-product-engineer" };
    expect(parseJobRef("linear/senior-product-engineer")).toEqual(want);
    expect(parseJobRef("https://himalayas.app/companies/linear/jobs/senior-product-engineer")).toEqual(want);
    expect(parseJobRef("https://himalayas.app/companies/linear/jobs/senior-product-engineer?utm_source=api")).toEqual(want);
    expect(parseJobRef("https://himalayas.app/jobs/api/companies/linear/jobs/senior-product-engineer")).toEqual(want);
    expect(parseJobRef("https://evil.io/companies/linear/jobs/x")).toBeNull();
    expect(parseJobRef("https://himalayas.app.evil.io/companies/linear/jobs/x")).toBeNull();
    expect(parseJobRef("just-a-slug")).toBeNull();
  });
});

describe("search", () => {
  test("buildQuery maps filters to API params; --jobage defaults sort to recent", () => {
    const p = buildQuery(
      opts({ query: "EDI", country: "CA", excludeWorldwide: true, seniority: ["Senior"], employmentType: ["Full Time"], jobage: 7, page: 2 }),
    );
    expect(p.get("q")).toBe("EDI");
    expect(p.get("country")).toBe("CA");
    expect(p.get("exclude_worldwide")).toBe("true");
    expect(p.get("seniority")).toBe("Senior");
    expect(p.get("employment_type")).toBe("Full Time");
    expect(p.get("sort")).toBe("recent");
    expect(p.get("page")).toBe("2");
    expect(buildQuery(opts({ jobage: 7, sort: "relevant" })).get("sort")).toBe("relevant");
    expect(buildQuery(opts()).has("sort")).toBe(false);
  });

  test("withinDays filters on the date", () => {
    const now = Date.parse("2026-11-01T12:00:00Z");
    expect(withinDays(toResult(job({ pubDate: 1793539125 })), 1, now)).toBe(true);
    expect(withinDays(toResult(job({ pubDate: 1792004190 })), 7, now)).toBe(false);
  });

  test("runSearch emits the contract JSON shape and applies --limit client-side", async () => {
    const url = mockFetch(200, { totalCount: 3, jobs: [job(), job(), job()] });
    const out = capture("stdout");
    expect(await runSearch(opts({ query: "x", country: "Canada", limit: 2 }))).toBe(0);
    const parsed = JSON.parse(out());
    expect(parsed.meta).toEqual({ count: 2, page: 1, total: 3, page_size: 3 });
    expect(parsed.results).toHaveLength(2);
    expect(new URL(url()).pathname).toBe("/jobs/api/search");
    expect(new URL(url()).searchParams.get("country")).toBe("Canada");
  });

  test("an API 400 surfaces as a BAD_ARG error on stderr", async () => {
    mockFetch(400, { ok: false, errors: "Invalid sort" });
    const err = capture("stderr");
    expect(await runSearch(opts())).toBe(1);
    expect(JSON.parse(err())).toEqual({ error: "Invalid sort", code: "BAD_ARG" });
  });
});

describe("detail", () => {
  test("410 Gone reports JOB_CLOSED", async () => {
    mockFetch(410, { expiryDate: 1793539125 });
    const err = capture("stderr");
    expect(await runDetail({ id: "a/b", format: "json" })).toBe(1);
    expect(JSON.parse(err()).code).toBe("JOB_CLOSED");
  });
  test("404 reports NOT_FOUND", async () => {
    mockFetch(404, {});
    const err = capture("stderr");
    expect(await runDetail({ id: "a/b", format: "json" })).toBe(1);
    expect(JSON.parse(err()).code).toBe("NOT_FOUND");
  });
  test("200 returns the job with a cleaned description", async () => {
    const url = mockFetch(200, { job: job() });
    const out = capture("stdout");
    expect(await runDetail({ id: "hh-group/integration-developer", format: "json" })).toBe(0);
    expect(new URL(url()).pathname).toBe("/jobs/api/companies/hh-group/jobs/integration-developer");
    expect(JSON.parse(out()).description).toContain("- EDI");
  });
});
