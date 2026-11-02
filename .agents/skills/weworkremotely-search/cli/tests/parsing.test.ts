import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ageToDays,
  decodeHtmlEntities,
  isEligible,
  matchesExact,
  parseJobCards,
  parseJobDetail,
  resolveCategory,
} from "../src/helpers";
import { normalizeId } from "../src/commands/detail";
import { buildUrl, filterCards } from "../src/commands/search";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

describe("parseJobCards (live excerpt, /remote-jobs/search?term=developer, 2026-11-01)", () => {
  const cards = parseJobCards(fixture("search-cards.html"));

  test("parses job cards and skips the paid ad card", () => {
    expect(cards.length).toBe(5);
    expect(cards.every((c) => !c.url.includes("listing_ads"))).toBe(true);
  });

  test("every card has id/title/url and all contract keys present", () => {
    for (const c of cards) {
      expect(c.id).toMatch(/^[a-z0-9-]+$/);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.url).toBe(`https://weworkremotely.com/remote-jobs/${c.id}`);
      for (const k of ["id", "title", "company", "location", "date", "url", "region"]) {
        expect(k in c).toBe(true);
      }
    }
  });

  test("region pills become region/location; job type and badges are separated", () => {
    const ritual = cards.find((c) => c.id === "ritual-developer-experience-engineer")!;
    expect(ritual.company).toBe("Ritual");
    expect(ritual.region).toBe("Anywhere in the World");
    expect(ritual.location).toBe(ritual.region);
    expect(ritual.jobType).toBe("Full-Time");
    expect(ritual.category).toBe("Full-Stack Programming");

    const lemon = cards.find((c) => c.id === "lemon-io-senior-vue-developer-1")!;
    expect(lemon.regions).not.toContain("Boosted");
    expect(lemon.regions).not.toContain("Top 100");
    expect(lemon.regions[0]).toBe("Andorra"); // flag emoji stripped
    expect(lemon.jobType).toBe("Contract");
  });

  test("relative age becomes an approximate ISO date", () => {
    const ateam = cards.find((c) => c.id.startsWith("a-team-"))!;
    expect(ateam.age).toBe("28d");
    expect(ateam.ageDays).toBe(28);
    expect(ateam.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("a malformed card does not break the rest", () => {
    const broken = '<li class=" new-listing-container "><a class="listing-link--unlocked" href="/remote-jobs/x-broken">';
    const html = broken + fixture("search-cards.html");
    expect(parseJobCards(html).length).toBe(5);
  });
});

describe("filters", () => {
  const cards = parseJobCards(fixture("search-cards.html"));

  test("--eligible Canada keeps Anywhere / North America / country lists naming Canada", () => {
    const out = filterCards(cards, { query: "developer", eligible: "Canada", exact: false, page: 1, format: "json" });
    expect(out.length).toBeGreaterThan(0);
    for (const c of out) expect(isEligible(c.regions, "Canada")).toBe(true);
  });

  test("isEligible", () => {
    expect(isEligible(["Anywhere in the World"], "Canada")).toBe(true);
    expect(isEligible(["North America Only"], "Canada")).toBe(true);
    expect(isEligible(["Canada Only"], "Canada")).toBe(true);
    expect(isEligible(["Canada and United States of America"], "Canada")).toBe(true);
    expect(isEligible(["USA Only"], "Canada")).toBe(false);
    expect(isEligible(["Latin America Only"], "Canada")).toBe(false);
    expect(isEligible(["Mexico"], "Canada")).toBe(false);
    expect(isEligible([], "Canada")).toBe(false);
    expect(isEligible(["USA Only"], "USA")).toBe(true);
  });

  test("matchesExact rejects substring hits (EDI vs Media)", () => {
    expect(matchesExact({ title: "Senior Paid Media Strategist", company: "Current" }, "EDI")).toBe(false);
    expect(matchesExact({ title: "EDI Integration Developer", company: "Acme" }, "EDI")).toBe(true);
    expect(matchesExact({ title: "Senior Integration Engineer", company: "Legion" }, "integration engineer")).toBe(true);
  });

  test("--jobage drops cards older than N days", () => {
    const out = filterCards(cards, { query: "developer", jobage: 7, exact: false, page: 1, format: "json" });
    for (const c of out) expect(c.ageDays!).toBeLessThanOrEqual(7);
  });

  test("ageToDays", () => {
    expect(ageToDays("New")).toBe(0);
    expect(ageToDays("4d")).toBe(4);
    expect(ageToDays("2w")).toBe(14);
    expect(ageToDays("1mo")).toBe(30);
    expect(ageToDays("soon")).toBeNull();
  });
});

describe("URLs and ids", () => {
  test("buildUrl uses the search page for a query and the category page otherwise", () => {
    expect(buildUrl({ query: "integration developer" })).toBe(
      "https://weworkremotely.com/remote-jobs/search?term=integration+developer",
    );
    expect(buildUrl({ category: "devops-sysadmin" })).toBe(
      "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs",
    );
  });

  test("resolveCategory accepts key or slug", () => {
    expect(resolveCategory("back-end-programming")?.id).toBe("18");
    expect(resolveCategory("remote-back-end-programming-jobs")?.id).toBe("18");
    expect(resolveCategory("nope")).toBeNull();
  });

  test("normalizeId", () => {
    expect(normalizeId("legion-senior-integration-engineer")).toBe("legion-senior-integration-engineer");
    expect(normalizeId("https://weworkremotely.com/remote-jobs/legion-senior-integration-engineer")).toBe(
      "legion-senior-integration-engineer",
    );
    expect(normalizeId("weworkremotely.com/remote-jobs/abc-def/")).toBe("abc-def");
    expect(normalizeId("https://evil.example/remote-jobs/abc")).toBeNull();
    expect(normalizeId("https://weworkremotely.com.evil.io/remote-jobs/abc")).toBeNull();
    expect(normalizeId("https://weworkremotely.com/remote-jobs/search?term=x")).toBeNull();
    expect(normalizeId("../etc/passwd")).toBeNull();
  });

  test("decodeHtmlEntities decodes &amp; last", () => {
    expect(decodeHtmlEntities("&amp;lt;b&amp;gt; &#39;x&#39; &#x1F600;")).toBe("&lt;b&gt; 'x' \u{1F600}");
  });
});

describe("parseJobDetail (live excerpt, legion-senior-integration-engineer)", () => {
  const job = parseJobDetail(fixture("detail-legion-excerpt.html"), "legion-senior-integration-engineer")!;

  test("core fields", () => {
    expect(job.title).toBe("Senior Integration Engineer");
    expect(job.company).toBe("Legion");
    expect(job.region).toBe("Mexico");
    expect(job.location).toBe("Mexico");
    expect(job.applicantCountries).toEqual(["MX"]);
    expect(job.date).toBe("2026-10-29T07:30:52Z");
    expect(job.jobType).toBe("Full-Time");
    expect(job.category).toBe("Back-End Programming");
    expect(job.url).toBe("https://weworkremotely.com/remote-jobs/legion-senior-integration-engineer");
  });

  test("description is decoded text with line breaks", () => {
    expect(job.description).toContain("Integration & Automation Solutions");
    expect(job.description).not.toMatch(/<[a-z/][^>]*>/i);
    expect(job.description).not.toContain("&amp;");
    expect(job.description).toContain("\n- ");
  });

  test("a page without a title returns null", () => {
    expect(parseJobDetail("<html></html>", "x")).toBeNull();
  });
});
