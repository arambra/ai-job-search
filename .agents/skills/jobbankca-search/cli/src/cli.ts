#!/usr/bin/env bun
// Self-contained CLI for searching Job Bank Canada (https://www.jobbank.gc.ca),
// the Government of Canada job board. Zero runtime dependencies: plain bun +
// fetch + regex parsing. robots.txt allows the search and posting paths with a
// 5-second Crawl-delay, which the CLI honours between every request it makes.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { normalizeWorkplace, type Workplace } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-") && a.length > 1) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `jobbankca-cli — search Job Bank Canada (jobbank.gc.ca / Guichet-Emplois)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title or skill). Job Bank maps titles to
                          NOC occupations, so results include related titles.
  --location, -l <text>   Province/territory ("ON", "Ontario") or Canadian city
                          ("Toronto", "Toronto, ON"; ~50 km radius). Default: all Canada.
  --remote [mode]         Work-location filter: remote (default when bare) | hybrid | onsite.
  --jobage <days>         Posted within N days (whole number >= 1).
  --page <n>              1-indexed page (25 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "integration developer" --remote --format table
  bun run src/cli.ts search -q "EDI" --remote --jobage 30 --format table
  bun run src/cli.ts search -q "software developer" -l "Toronto, ON" --remote hybrid --format table
  bun run src/cli.ts search -q "programmer analyst" -l QC --jobage 2 --format table
  bun run src/cli.ts detail 50495396 --format plain

Requests are spaced >= 5 s apart (robots.txt Crawl-delay: 5).
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "remote", "jobage", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  // Unknown flags are rejected, never silently dropped: a discarded filter
  // changes what the search returns with no error.
  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }

  if (cmd === "search") {
    const extra = (flags._ as string[]).slice(1)
    if (extra.length) {
      return fail(
        `unexpected argument "${extra[0]}" - pass keywords with --query/-q (a bare --remote takes no value other than remote|hybrid|onsite)`,
        "BAD_ARG",
      )
    }
    for (const name of ["query", "location"] as const) {
      if (flags[name] !== undefined && (typeof flags[name] !== "string" || !(flags[name] as string).trim())) {
        return fail(`--${name} requires a non-empty value`, "BAD_ARG")
      }
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }

    let remote: Workplace | undefined
    if (flags.remote !== undefined) {
      const w = flags.remote === true ? "remote" : normalizeWorkplace(String(flags.remote))
      if (!w) return fail(`--remote must be one of remote|hybrid|onsite, got "${flags.remote}"`, "BAD_ARG")
      remote = w
    }

    const intFlag = (name: string): number | null | undefined => {
      const raw = flags[name]
      if (raw === undefined) return undefined
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
        return null
      }
      return val
    }
    const jobage = intFlag("jobage")
    if (jobage === null) return 1
    const page = intFlag("page")
    if (page === null) return 1
    const limit = intFlag("limit")
    if (limit === null) return 1

    if (!flags.query && !flags.location && !remote && !jobage) {
      return fail(
        "search needs at least one of --query, --location, --remote or --jobage (an unfiltered search returns every posting in Canada)",
        "NO_FILTER",
      )
    }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query.trim() : undefined,
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      remote,
      jobage,
      page: page ?? 1,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <id|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return fail(`Unknown command "${cmd}"`, "BAD_CMD")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
