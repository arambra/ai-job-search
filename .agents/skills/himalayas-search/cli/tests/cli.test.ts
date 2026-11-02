import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

interface SearchOut {
  meta: { count: number; page: number };
  results: Array<{ id: string; title: string; url: string; eligible_countries: string[]; worldwide: boolean }>;
}

describe("argument validation (offline)", () => {
  test("a bogus flag exits 1 with a JSON error on stderr", async () => {
    const r = await runCLI(["search", "-q", "edi", "--bogus", "x"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(JSON.parse(r.stderr).code).toBe("UNKNOWN_FLAG");
  });
  test("detail without an id exits 1 with NO_ID", async () => {
    const r = await runCLI(["detail"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("NO_ID");
  });
  test("a bad seniority value is rejected before any request", async () => {
    const r = await runCLI(["search", "--seniority", "guru"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG");
  });
  test("--jobage must be a positive whole number", async () => {
    const r = await runCLI(["search", "--jobage", "0.5"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG");
  });
  test("detail rejects a non-Himalayas URL", async () => {
    const r = await runCLI(["detail", "https://example.com/companies/a/jobs/b"]);
    expect(r.exitCode).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe("BAD_ID");
  });
});

// One live request, kept small: the keyless allowance is shared by every caller.
describe("live smoke test", () => {
  test("search 'integration developer' in Canada returns eligible results", async () => {
    const out = parseJSON<SearchOut>(
      await runCLI(["search", "-q", "integration developer", "--country", "CA", "--limit", "3"]),
    );
    expect(out.meta.page).toBe(1);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    for (const r of out.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toStartWith("https://himalayas.app/");
      expect(r.worldwide || r.eligible_countries.includes("Canada")).toBe(true);
    }
  });
});
