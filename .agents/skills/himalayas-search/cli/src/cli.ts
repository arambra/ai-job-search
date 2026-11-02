#!/usr/bin/env bun
// Self-contained CLI for the Himalayas public Remote Jobs API (https://himalayas.app/api).
// No CLI framework and zero runtime dependencies: runs anywhere `bun` is available.

import { runSearch, EMPLOYMENT_TYPES, SENIORITIES, SORTS, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit", c: "country" }

// Flags that never take a value, so `--worldwide -q x` and `--worldwide foo` parse predictably.
const BOOLEAN_FLAGS = new Set(["worldwide", "exclude-worldwide", "help", "h"])

export function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-") || a === "-") {
      ;(flags._ as string[]).push(a)
      continue
    }
    let name = a.replace(/^-+/, "")
    let value: string | boolean = true
    const eq = name.indexOf("=")
    if (eq > 0) {
      value = name.slice(eq + 1)
      name = name.slice(0, eq)
    }
    const key = ALIAS[name] ?? name
    if (value === true && !BOOLEAN_FLAGS.has(key)) {
      const next = argv[i + 1]
      // Allow negative numbers (e.g. --timezone -5) as values.
      if (next !== undefined && (!next.startsWith("-") || /^-\d/.test(next))) {
        value = next
        i++
      }
    }
    flags[key] = value
  }
  return flags
}

const HELP = `himalayas-cli - search remote jobs on Himalayas (himalayas.app) via its public JSON API

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [filters] [--format json|table|plain]
  bun run src/cli.ts detail <company/slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>        Free-text query (title, skill, role).
  --country, -c <country>   Only jobs open to candidates in this country (ISO alpha-2,
                            name or slug: CA, Canada, US). Worldwide jobs are included
                            unless --exclude-worldwide is set. Server-side.
  --exclude-worldwide       With --country: drop worldwide (unrestricted) jobs.
  --worldwide               Only worldwide-friendly jobs.
  --jobage <days>           Posted/updated within N days (client-side on pubDate;
                            defaults --sort to recent).
  --seniority <list>        Comma list: ${SENIORITIES.join(", ")}
  --employment-type <list>  Comma list: ${EMPLOYMENT_TYPES.join(", ")}
  --company <slug>          Company slug(s), comma-separated (a result's company_slug).
  --timezone <offset>       UTC offset, e.g. -5, UTC-5, UTC+05:30.
  --sort <order>            ${SORTS.join(" | ")} (default relevant).
  --page <n>                1-indexed page (the API serves 20 jobs per page). Default 1.
  --limit, -n <n>           Client-side cap on results shown (max 20 per page). Default 20.
  --format <fmt>            json (default) | table | plain.

DETAIL
  <company/slug|url>        A search result's id (e.g. unlimited-potential/integration-developer)
                            or a https://himalayas.app/companies/<company>/jobs/<slug> URL.

ENVIRONMENT
  HIMALAYAS_API_TOKEN       Optional free API key (higher rate limit). Never pass it as a flag.

EXAMPLES
  bun run src/cli.ts search -q "integration developer" --country CA --format table
  bun run src/cli.ts search -q "EDI" --country Canada --jobage 14 --format table
  bun run src/cli.ts detail unlimited-potential/integration-developer --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set([
    "query", "country", "exclude-worldwide", "worldwide", "jobage", "seniority", "employment-type",
    "company", "timezone", "sort", "page", "limit", "format", "help", "h",
  ]),
  detail: new Set(["format", "help", "h"]),
}

function bad(error: string, code = "BAD_ARG"): number {
  writeError(error, code)
  return 1
}

function parsePositiveInt(name: string, raw: string | boolean | string[]): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1) {
    writeError(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
    return null
  }
  return val
}

/** Map a comma list onto a closed vocabulary case-insensitively (and ignoring spaces/hyphens). */
function canonicalList(name: string, raw: string, vocab: readonly string[]): { values?: string[]; error?: string } {
  const key = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "")
  const out: string[] = []
  for (const item of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const hit = vocab.find((v) => key(v) === key(item))
    if (!hit) return { error: `--${name} value "${item}" is not one of: ${vocab.join(", ")}` }
    out.push(hit)
  }
  if (out.length === 0) return { error: `--${name} requires a non-empty value` }
  return { values: out }
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const known = KNOWN_FLAGS[cmd]
  if (!known) return bad(`Unknown command "${cmd}" - use search or detail`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key === "_" || known.has(key)) continue
    return bad(
      `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help`,
      "UNKNOWN_FLAG",
    )
  }

  if (cmd === "search") {
    for (const name of ["query", "country", "seniority", "employment-type", "company", "timezone", "sort", "format"]) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !v.trim())) return bad(`--${name} requires a non-empty value`)
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return bad(`--format must be one of json|table|plain, got "${fmt}"`)

    const nums: Record<string, number> = {}
    for (const name of ["jobage", "page", "limit"]) {
      if (flags[name] === undefined) continue
      const v = parsePositiveInt(name, flags[name])
      if (v === null) return 1
      nums[name] = v
    }

    let seniority: string[] = []
    if (typeof flags.seniority === "string") {
      const r = canonicalList("seniority", flags.seniority, SENIORITIES)
      if (r.error) return bad(r.error)
      seniority = r.values!
    }
    let employmentType: string[] = []
    if (typeof flags["employment-type"] === "string") {
      const r = canonicalList("employment-type", flags["employment-type"], EMPLOYMENT_TYPES)
      if (r.error) return bad(r.error)
      employmentType = r.values!
    }
    let sort: string | undefined
    if (typeof flags.sort === "string") {
      const r = canonicalList("sort", flags.sort, SORTS)
      if (r.error || r.values!.length !== 1) return bad(r.error ?? "--sort takes a single value")
      sort = r.values![0]
    }
    if (flags["exclude-worldwide"] && !flags.country) return bad("--exclude-worldwide only applies together with --country")
    if (flags["exclude-worldwide"] && flags.worldwide) return bad("--worldwide and --exclude-worldwide contradict each other")

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      jobage: nums.jobage,
      page: nums.page ?? 1,
      limit: nums.limit ?? 20,
      format: fmt as SearchOpts["format"],
      country: typeof flags.country === "string" ? flags.country.trim() : undefined,
      worldwide: flags.worldwide === true,
      excludeWorldwide: flags["exclude-worldwide"] === true,
      seniority,
      employmentType,
      company: typeof flags.company === "string" ? flags.company.trim() : undefined,
      timezone: typeof flags.timezone === "string" ? flags.timezone.trim() : undefined,
      sort,
    }
    return runSearch(opts)
  }

  // detail
  const id = (flags._ as string[])[1]
  if (!id) return bad("detail requires a <company/slug|url>", "NO_ID")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) return bad(`--format must be one of json|plain, got "${fmt}"`)
  const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
  return runDetail(opts)
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
      process.exit(1)
    })
}
