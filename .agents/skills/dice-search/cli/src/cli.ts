#!/usr/bin/env bun
// Self-contained CLI for searching jobs on Dice (https://www.dice.com), a US
// tech job board. Zero runtime dependencies: plain bun + fetch + regex/JSON
// parsing of the public search and job-detail pages.
//
// Personal use only. dice.com's robots.txt disallows the search (/jobs?q*) and
// detail (/job...) paths this tool reads. The user chose to run it anyway for
// low-volume personal job searching: keep volume low, do not use it
// commercially or for bulk data collection. Run it on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { workplaceFilter } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", l: "location", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
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

const HELP = `dice-cli - search US tech jobs on Dice (dice.com)

USAGE
  bun run src/cli.ts search --query "<keywords>" [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords (job title, skill). REQUIRED.
  --remote <mode>         remote | hybrid | onsite  (Dice filters.workplaceTypes).
  --jobage <days>         Posted within N days. 1/3/7 map to Dice's posted-date
                          filter (Today / Last 3 / Last 7 days); every value is
                          also enforced client-side on the posted date.
  --location, -l <text>   US place, e.g. "Austin, TX" (Dice location, 30 mi radius).
  --page <n>              1-indexed page (30 results/page). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "integration developer" --remote remote --format table
  bun run src/cli.ts search -q "EDI" --remote remote --jobage 7 --format table
  bun run src/cli.ts detail a7f7c2dd-df6c-48d3-85b5-c3afa257a72d --format plain

Personal use only - dice.com's robots.txt disallows these paths; keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "location", "jobage", "remote", "page", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (!knownFlags) return fail(`Unknown command "${cmd}"`, "BAD_CMD")
  for (const key of Object.keys(flags)) {
    if (key === "_" || knownFlags.has(key)) continue
    return fail(
      `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
      "UNKNOWN_FLAG",
    )
  }

  if (cmd === "search") {
    if (typeof flags.query !== "string" || !flags.query.trim()) {
      return fail('the --query/-q flag is required and needs a non-empty value (e.g. -q "integration developer")', "NO_QUERY")
    }
    if (flags.location !== undefined && (typeof flags.location !== "string" || !flags.location.trim())) {
      return fail("--location requires a non-empty value", "BAD_ARG")
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }
    if (flags.remote !== undefined && (typeof flags.remote !== "string" || workplaceFilter(flags.remote) === null)) {
      const got = typeof flags.remote === "string" ? `"${flags.remote}"` : "no value"
      return fail(`--remote must be one of remote|hybrid|onsite, got ${got}`, "BAD_ARG")
    }

    const ints: Record<string, number | undefined> = {}
    for (const name of ["jobage", "page", "limit"]) {
      const raw = flags[name]
      if (raw === undefined) continue
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        return fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
      }
      ints[name] = val
    }

    const opts: SearchOpts = {
      query: (flags.query as string).trim(),
      location: typeof flags.location === "string" ? flags.location.trim() : undefined,
      jobage: ints.jobage,
      remote: typeof flags.remote === "string" ? flags.remote : undefined,
      page: ints.page ?? 1,
      limit: ints.limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  // detail
  const id = (flags._ as string[])[1]
  if (!id) return fail("detail requires an <id|url>", "NO_ID")
  const fmt = flags.format !== undefined ? String(flags.format) : "json"
  if (!["json", "plain"].includes(fmt)) {
    return fail(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
  }
  const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
  return runDetail(opts)
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })
