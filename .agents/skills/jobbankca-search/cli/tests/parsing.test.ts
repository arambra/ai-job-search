// Offline parser tests. The markup below is trimmed from live Job Bank pages
// (search results and posting details, fetched 2026-11-01).
import { describe, expect, test } from "bun:test"
import {
  jobageToFage,
  normalizeWorkplace,
  parseCitySuggest,
  parseDate,
  parseJobCards,
  parseJobDetail,
  parseTotal,
  provinceCode,
  workplaceParams,
} from "../src/helpers"
import { normalizeId } from "../src/commands/detail"
import { buildUrl } from "../src/commands/search"

const PARTNER_CARD = `<article id="article-50631395" class="action-buttons"><a href="/jobsearch/jobposting/50631395;jsessionid=X.jobsearch74?source=searchresults" class="resultJobItem">
  <h3 class="title">
    <span class="flag"><span class="new">New</span></span>
    <span class="job-source job-source-icon-6"><span class="wb-inv">SaskJobs</span></span>
    <span class="noctitle"> Web developer
    </span>
  </h3>
  <ul class="list-unstyled">
    <li class="date">November 01, 2026
    </li>
    <li class="business">TABOCHE TECHNOLOGY</li>
    <li class="location"><span class="fas fa-map-marker-alt" aria-hidden="true"></span> <span class="wb-inv">Location</span>
          Regina (SK)
    </li>
    <li class="salary"><span class="fa fa-dollar" aria-hidden="true"></span>
          Salary
          32-40 per hour</li>
    <li class="source"><span class="job-source job-source-icon-6"><span class="wb-inv">SaskJobs</span></span>
      <span class="wb-inv">Job number:</span>
      <span class="fa fa-hashtag" aria-hidden="true"></span>
      1556592</li>
  </ul></a>
</article>`

const REMOTE_CARD = `<article id="article-50495396" class="action-buttons"><a href="/jobsearch/jobposting/50495396?source=searchresults" class="resultJobItem">
  <h3 class="title">
    <span class="flag"><span class="telework">Remote</span><span class="appmethod">Direct Apply</span></span>
    <span class="noctitle"> systems QA (quality assurance) analyst
    </span>
  </h3>
  <ul class="list-unstyled">
    <li class="date">October 14, 2026</li>
    <li class="business">BRAINY YACK INTERNET SOLUTIONS INC.</li>
    <li class="location"><span class="fas fa-map-marker-alt" aria-hidden="true"></span> <span class="wb-inv">Location</span>Toronto, ON
    </li>
    <li class="source"><span class="job-source job-source-icon-16"><span class="wb-inv">Job Bank</span></span>
      <span class="wb-inv">Job number:</span> 3694978</li>
  </ul></a>
</article>`

const SEARCH_PAGE = `<h2><span class="found" id="results-count">273</span> results</h2>
${PARTNER_CARD}
<article id="article-99999999" class="action-buttons"><span class="noctitle"></span></article>
${REMOTE_CARD}`

const EMPLOYER_DETAIL = `<div vocab="http://schema.org/" typeof="JobPosting">
  <h1 property="name" id="wb-cont" class="title"><span property="title">systems QA (quality assurance) analyst
    </span></h1>
  <p class="date-business">
    <span property="datePosted" class="date"> Posted on
      October 14, 2026
    </span> <span> by </span>
    <span class="business"><span class="wb-inv">Employer details</span>
      <span property="hiringOrganization" typeof="Organization">
        <span property="name">
            <a href="https://www.example.com/" class="external" target="_blank">BRAINY YACK INTERNET SOLUTIONS INC.
              <span class="fa fa-external-link" aria-hidden="true"></span> <span class="wb-inv ext-desc"> This link will open in a new window</span>
            </a>
        </span>
      </span>
    </span>
  </p>
  <span class="hidden" property="description">Education: College. Workplace information: Remote.</span>
  <ul class="job-posting-brief colcount-lg-2 ">
    <li><span class="fas fa-map-marker-alt" aria-hidden="true"></span>
      <span class="wb-inv">Location</span>
      <span>Remote <span class="city">based in Toronto, ON</span></span>
    </li>
    <li>
      <span class="fa-icon-desc fa-icon fas fa-laptop" aria-hidden="true"></span>
      <span class="wb-inv">Work location</span>
      <span>Remote</span>
    </li>
    <li><span class="fa fa-dollar" aria-hidden="true"></span>
      <span class="wb-inv">Salary</span><span class="attribute-value" property="baseSalary" typeof="MonetaryAmount"><span property="value" typeof="QuantitativeValue"><span property="currency" content="CAD" class="hidden">$</span><span property="minValue" content="49.00">49.00</span><span property="unitText" class="hidden">HOUR</span> hourly</span> /  <span property='workHours'> 40 hours per week</span></span>
    </li>
    <li><span class="wb-inv">Terms of employment</span>
      <span property="employmentType" class="attribute-value">Permanent employment<span style="display: block;" class="attribute-value">Full time</span>
      </span>
    </li>
    <li><span>Starts as soon as possible</span></li>
    <li><span class="wb-inv">vacancies</span><span>1 vacancy</span></li>
    <li><span class="wb-inv">Source</span>
      <span class="source-image"><span class="job-source job-source-icon-16" aria-hidden="true"></span></span>
      <span>Job Bank</span>
      <span>#3694978</span>
    </li>
  </ul>
  <div class="main-job-posting-detail job-posting-detail-requirements ">
    <h3>Overview</h3>
    <h4>Languages</h4>
    <p property="qualification">English</p>
    <div class="mrgn-tp-lg" id="jobOverview-2" property="responsibilities">
      <h3>Responsibilities</h3>
      <h4>Tasks</h4>
      <ul class="csvlist">
          <span>Document technical requirements</span>
          <span>Usability testing &amp; QA</span>
      </ul>
    </div>
  </div>
  <div class="job-posting-detail-apply">
    <div class="external-job mrgn-bttm-lg ">
      <a class="btn btn-primary" href="https://example.com/apply" target="_blank">Learn more about this job</a>
    </div>
    <h3>Advertised until</h3>
    <p property="validThrough">2026-11-04
    </p>
  </div>
</div>`

const PARTNER_DETAIL = `<span property="title">Web developer</span>
<span property="datePosted" class="date"> Posted on November 01, 2026 </span>
<span property="hiringOrganization" typeof="Organization">
  <span property="name">
      <strong>TABOCHE TECHNOLOGY</strong>
  </span>
</span>
<span class="hidden" property="description">Intro sentence.Build and test websites. *Responsibilities* * Develop apps. * Fix bugs.</span>
<ul class="job-posting-brief colcount-lg-2 ">
  <li><span class="wb-inv">Location</span>
    <span><span property="joblocation" typeof="Place"><span class="city" property="address" typeof="PostalAddress"><span property="addressLocality">Regina</span>, <span property="addressRegion">SK</span></span></span></span>
    <span class="wb-inv">Work location</span>
    <span>On site</span>
  </li>
</ul>
<a id="externalJobLink" class="btn btn-primary" href="https://www.saskjobs.ca/jsp/joborder/detail.jsp?job_order_id=1556592&amp;x=1">View</a>
<p property="validThrough">2027-03-01</p>`

describe("parseJobCards", () => {
  test("parses partner and employer cards, skipping a malformed one", () => {
    const cards = parseJobCards(SEARCH_PAGE)
    expect(cards).toHaveLength(2)
    expect(cards[0]).toEqual({
      id: "50631395",
      title: "Web developer",
      company: "TABOCHE TECHNOLOGY",
      location: "Regina (SK)",
      date: "2026-11-01",
      url: "https://www.jobbank.gc.ca/jobsearch/jobposting/50631395",
      workplace: null,
      salary: "32-40 per hour",
      source: "SaskJobs",
      sourceJobNumber: "1556592",
    })
    expect(cards[1].workplace).toBe("remote")
    expect(cards[1].location).toBe("Toronto, ON")
    expect(cards[1].source).toBe("Job Bank")
    expect(cards[1].sourceJobNumber).toBe("3694978")
  })

  test("reads the total hit count", () => {
    expect(parseTotal(SEARCH_PAGE)).toBe(273)
    expect(parseTotal("<p>nothing</p>")).toBeNull()
  })
})

describe("parseJobDetail", () => {
  test("employer posting: RDFa fields, workplace and structured description", () => {
    const d = parseJobDetail(EMPLOYER_DETAIL, "50495396")
    expect(d.title).toBe("systems QA (quality assurance) analyst")
    expect(d.company).toBe("BRAINY YACK INTERNET SOLUTIONS INC.")
    expect(d.date).toBe("2026-10-14")
    expect(d.location).toBe("Remote based in Toronto, ON")
    expect(d.workplace).toBe("remote")
    expect(d.workplaceLabel).toBe("Remote")
    expect(d.salary).toBe("$49.00 hourly / 40 hours per week")
    expect(d.employmentType).toBe("Permanent employment, Full time")
    expect(d.vacancies).toBe("1 vacancy")
    expect(d.source).toBe("Job Bank")
    expect(d.sourceJobNumber).toBe("3694978")
    expect(d.applyUrl).toBe("https://example.com/apply")
    expect(d.deadline).toBe("2026-11-04")
    expect(d.isActive).toBe(true)
    expect(d.description).toContain("## Responsibilities")
    expect(d.description).toContain("- Usability testing & QA")
    expect(d.description).not.toContain("<")
  })

  test("partner posting: falls back to the hidden description with restored breaks", () => {
    const d = parseJobDetail(PARTNER_DETAIL, "50631395")
    expect(d.company).toBe("TABOCHE TECHNOLOGY")
    expect(d.location).toBe("Regina, SK")
    expect(d.workplace).toBe("onsite")
    expect(d.applyUrl).toBe("https://www.saskjobs.ca/jsp/joborder/detail.jsp?job_order_id=1556592&x=1")
    expect(d.deadline).toBe("2027-03-01")
    expect(d.description).toBe("Intro sentence.\nBuild and test websites.\n\nResponsibilities\n- Develop apps.\n- Fix bugs.")
    // Every contract field is present (null, never omitted).
    expect(d.vacancies).toBeNull()
    expect("salary" in d).toBe(true)
  })
})

describe("helpers", () => {
  test("parseDate handles English, French and ISO", () => {
    expect(parseDate("November 01, 2026")).toBe("2026-11-01")
    expect(parseDate("1er novembre 2026")).toBe("2026-11-01")
    expect(parseDate("2026-03-01")).toBe("2026-03-01")
    expect(parseDate("soon")).toBeNull()
  })

  test("workplace filter values match the site's Work location facet", () => {
    expect(workplaceParams("remote")).toEqual(["15141"])
    expect(workplaceParams("hybrid")).toEqual(["100000"])
    expect(workplaceParams("onsite")).toEqual(["¬15141", "¬100000", "¬100001", "¬100006"])
    expect(normalizeWorkplace("télétravail")).toBe("remote")
    expect(normalizeWorkplace("on-site")).toBe("onsite")
    expect(normalizeWorkplace("anywhere")).toBeNull()
  })

  test("jobage maps to the 48h / 30d buckets", () => {
    expect(jobageToFage(1)).toBe("2")
    expect(jobageToFage(7)).toBe("30")
    expect(jobageToFage(90)).toBeNull()
    expect(jobageToFage(undefined)).toBeNull()
  })

  test("province codes and names", () => {
    expect(provinceCode("ON")).toBe("ON")
    expect(provinceCode("ontario")).toBe("ON")
    expect(provinceCode("Québec")).toBe("QC")
    expect(provinceCode("Toronto")).toBeNull()
  })

  test("city-suggest response resolves to a city_id", () => {
    const json = JSON.stringify({
      response: { docs: [{ name: "Toronto", city_id: "22437", province_cd: "ON", doctype: "C" }] },
    })
    expect(parseCitySuggest(json, "Toronto", null)).toEqual({ cityId: "22437", name: "Toronto", province: "ON" })
    expect(parseCitySuggest(json, "Toronto", "BC")).toBeNull()
    expect(parseCitySuggest("not json", "Toronto", null)).toBeNull()
  })

  test("buildUrl emits the real search parameters", () => {
    const url = new URL(
      buildUrl({ query: "integration developer", remote: "remote", jobage: 7, page: 2, format: "json" }, { kind: "province", code: "ON" }),
    )
    expect(url.pathname).toBe("/jobsearch/jobsearch")
    expect(url.searchParams.get("searchstring")).toBe("integration developer")
    expect(url.searchParams.get("fprov")).toBe("ON")
    expect(url.searchParams.getAll("fskl")).toEqual(["15141"])
    expect(url.searchParams.get("fage")).toBe("30")
    expect(url.searchParams.get("sort")).toBe("D")
    expect(url.searchParams.get("page")).toBe("2")
    const city = new URL(buildUrl({ page: 1, format: "json" }, { kind: "city", cityId: "22437", label: "Toronto, ON" }))
    expect(city.searchParams.get("locationparam")).toBe("22437")
    expect(city.searchParams.get("locationstring")).toBe("Toronto, ON")
  })

  test("normalizeId accepts IDs and Job Bank URLs only", () => {
    expect(normalizeId("50495396")).toBe("50495396")
    expect(normalizeId("https://www.jobbank.gc.ca/jobsearch/jobposting/50495396")).toBe("50495396")
    expect(normalizeId("www.jobbank.gc.ca/jobsearch/jobposting/50495396;jsessionid=AB.js74?source=searchresults")).toBe("50495396")
    expect(normalizeId("https://www.guichetemplois.gc.ca/jobsearch/jobposting/50495396")).toBe("50495396")
    expect(normalizeId("https://ca.indeed.com/jobposting/50495396")).toBeNull()
    expect(normalizeId("https://jobbank.gc.ca.evil.io/jobsearch/jobposting/50495396")).toBeNull()
    expect(normalizeId("abc")).toBeNull()
  })
})
