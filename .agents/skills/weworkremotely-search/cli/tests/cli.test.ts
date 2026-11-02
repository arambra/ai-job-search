import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

function stderrJSON(stderr: string): { error?: string; code?: string } {
  try {
    return JSON.parse(stderr);
  } catch {
    return {};
  }
}

// Argument validation: these exit before any network request.
describe("CLI argument validation", () => {
  test("bogus flag exits 1 with UNKNOWN_FLAG on stderr", async () => {
    const r = await runCLI(["search", "-q", "developer", "--bogus", "x"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(stderrJSON(r.stderr).code).toBe("UNKNOWN_FLAG");
  });

  test("search without --query or --category exits 1 with NO_QUERY", async () => {
    const r = await runCLI(["search"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("NO_QUERY");
  });

  test("empty --query exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "-q", ""]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG");
  });

  test("unknown --category exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "--category", "nope"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG");
  });

  test("non-integer --jobage exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "-q", "developer", "--jobage", "0.5"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG");
  });

  test("bad --format exits 1 with BAD_ARG", async () => {
    const r = await runCLI(["search", "-q", "developer", "--format", "xml"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("BAD_ARG");
  });

  test("detail without id exits 1 with NO_ID", async () => {
    const r = await runCLI(["detail"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("NO_ID");
  });

  test("detail with a foreign-host URL exits 1 with BAD_ID", async () => {
    const r = await runCLI(["detail", "https://example.com/remote-jobs/abc"]);
    expect(r.exitCode).toBe(1);
    expect(stderrJSON(r.stderr).code).toBe("BAD_ID");
  });
});

// Live smoke test: one search request + one detail request.
// "developer" is used instead of the candidate's niche test query
// ("integration developer"), which can legitimately return 0 results on WWR.
describe("live smoke test", () => {
  test("search 'developer' returns >=1 result with id/title/url and nulls not omitted", async () => {
    const out = parseJSON<{ meta: { count: number; page: number }; results: Record<string, unknown>[] }>(
      await runCLI(["search", "-q", "developer", "--limit", "3"]),
    );
    expect(out.meta.page).toBe(1);
    expect(out.meta.count).toBeGreaterThanOrEqual(1);
    expect(out.results.length).toBe(out.meta.count);
    for (const r of out.results) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.title).toBe("string");
      expect(String(r.url)).toStartWith("https://weworkremotely.com/remote-jobs/");
      for (const k of ["company", "location", "date", "region"]) expect(k in r).toBe(true);
    }

    const d = parseJSON<{ id: string; title: string; description: string | null }>(
      await runCLI(["detail", String(out.results[0].id)]),
    );
    expect(d.id).toBe(String(out.results[0].id));
    expect(d.title.length).toBeGreaterThan(0);
    expect(d.description).toBeTruthy();
  });
});
