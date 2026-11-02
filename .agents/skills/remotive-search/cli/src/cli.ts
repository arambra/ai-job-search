#!/usr/bin/env bun
// Self-contained CLI for Remotive's official public remote-jobs API.
// Zero runtime dependencies: plain bun + fetch. One API request per command
// (responses cached on disk, default 6 h) to respect Remotive's documented
// limit of a few calls a day; filtering and paging happen client-side.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { writeError } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit", c: "country" }

// Flags that never take a value (so a following positional is not swallowed).
const BOOLEAN_FLAGS = new Set(["no-description", "help", "h"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-") || a === "-") {
      ;(flags._ as string[]).push(a)
      continue
    }
    const eq = a.indexOf("=")
    const rawName = (eq > 0 ? a.slice(0, eq) : a).replace(/^-+/, "")
    const key = ALIAS[rawName] ?? rawName
    if (eq > 0) {
      flags[key] = a.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("-")) {
      flags[key] = next
      i++
    } else {
      flags[key] = true
    }
  }
  return flags
}

const HELP = `remotive-cli - search Remotive's remote-only job board (official public API)

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [flags] [--format json|table|plain]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords: case-insensitive partial match of the whole
                          phrase against title and description (API "search").
  --country, -c <name>    Keep only jobs a resident of <name> may apply to: the
                          required location names the country, a region that
                          contains it (e.g. Canada: North America, Americas), or
                          Worldwide/Anywhere. Names or codes: canada, ca, usa, uk...
  --category <name|slug>  Remotive category, e.g. software-development, devops, data.
  --company <name>        Company name, partial match (API "company_name").
  --jobage <days>         Posted within N days (client-side; listings are delayed 24h).
  --page <n>              1-indexed page (client-side). Default 1.
  --limit, -n <n>         Results per page (client-side). Default 25.
  --no-description        Omit the (HTML-stripped) description from JSON results.
  --format <fmt>          json (default) | table | plain.

DETAIL
  <id|url>                A Remotive job id (search result "id") or a
                          https://remotive.com/remote-jobs/<category>/<slug>-<id> URL.

ENVIRONMENT
  REMOTIVE_CACHE_TTL_MIN  Response cache lifetime in minutes (default 360; 0 = off).
  REMOTIVE_CACHE_DIR      Cache directory (default: <tmp>/remotive-cli-cache).

Remotive's terms: link back to the Remotive URL and credit Remotive as the source;
listings are delayed 24h; call the API at most ~4 times a day (>2/min is blocked).
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "country", "category", "company", "jobage", "page", "limit", "format", "no-description", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function bad(error: string): number {
  writeError(error, "BAD_ARG")
  return 1
}

function intFlag(name: string, raw: string | boolean | string[] | undefined, fallback: number): number | null {
  if (raw === undefined) return fallback
  const v = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(v) || v < 1) {
    bad(`--${name} must be a whole number of at least 1, got "${raw}"`)
    return null
  }
  return v
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = flags._[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const known = KNOWN_FLAGS[cmd]
  if (!known) {
    writeError(`Unknown command "${cmd}" (expected search or detail)`, "BAD_CMD")
    return 1
  }
  for (const key of Object.keys(flags)) {
    if (key === "_" || known.has(key)) continue
    writeError(`unknown flag --${key} for '${cmd}'; see --help for the supported flags`, "UNKNOWN_FLAG")
    return 1
  }

  if (cmd === "search") {
    for (const name of ["query", "country", "category", "company"]) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !v.trim())) return bad(`--${name} requires a non-empty value`)
    }
    const fmt = flags.format === undefined ? "json" : String(flags.format)
    if (!["json", "table", "plain"].includes(fmt)) return bad(`--format must be one of json|table|plain, got "${fmt}"`)
    const page = intFlag("page", flags.page, 1)
    const limit = intFlag("limit", flags.limit, 25)
    const jobage = flags.jobage === undefined ? undefined : intFlag("jobage", flags.jobage, 0)
    if (page === null || limit === null || jobage === null) return 1

    const str = (k: string) => (typeof flags[k] === "string" ? (flags[k] as string).trim() : undefined)
    const opts: SearchOpts = {
      query: str("query"),
      country: str("country"),
      category: str("category"),
      company: str("company"),
      jobage,
      page,
      limit,
      format: fmt as SearchOpts["format"],
      includeDescription: flags["no-description"] === undefined,
    }
    return runSearch(opts)
  }

  // detail
  const id = flags._[1]
  if (!id) {
    writeError("detail requires a <id|url>", "NO_ID")
    return 1
  }
  const fmt = flags.format === undefined ? "json" : String(flags.format)
  if (!["json", "plain"].includes(fmt)) return bad(`--format must be one of json|plain, got "${fmt}"`)
  const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
  return runDetail(opts)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
