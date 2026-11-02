#!/usr/bin/env bun
// Self-contained CLI for searching remote jobs on We Work Remotely
// (https://weworkremotely.com), a remote-only job board. Zero runtime
// dependencies: plain bun + fetch + regex parsing of the public pages.
// robots.txt allows the search, category and job pages; keep volume low anyway.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { CATEGORIES, resolveCategory } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

// Flags that never take a value (so `--exact devops` cannot swallow a positional).
const BOOLEAN_FLAGS = new Set(["exact", "help", "h"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit", c: "category" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-") && a.length > 1) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("-")) {
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

const HELP = `weworkremotely-cli — search remote jobs on We Work Remotely (remote-only, global)

USAGE
  bun run src/cli.ts search --query "<keywords>" [flags]
  bun run src/cli.ts search --category <key> [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS (at least one of --query / --category is required)
  --query, -q <text>      Keywords. WWR matches them as a substring of title/company.
  --category, -c <key>    One of: ${Object.keys(CATEGORIES).join(", ")}
                          (the full slug, e.g. remote-devops-sysadmin-jobs, also works).
  --exact                 Keep only results where every query word is a whole word in
                          title/company (WWR's substring match makes "EDI" hit "Media").
  --eligible <country>    Keep only jobs open to applicants in <country>: "Anywhere in the
                          World", a region pill naming the country, or a group covering it
                          (e.g. "North America Only" for Canada). e.g. --eligible Canada
  --jobage <days>         Posted within N days (client-side, from the card's "New"/"4d" age).
  --page <n>              1-indexed page of 25 results (client-side). Default 1.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "integration" --eligible Canada --format table
  bun run src/cli.ts search -q "EDI" --exact --format table
  bun run src/cli.ts search -q "developer" --category back-end-programming --jobage 7 --format table
  bun run src/cli.ts search --category devops-sysadmin --eligible Canada --format table
  bun run src/cli.ts detail legion-senior-integration-engineer --format plain
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "category", "exact", "eligible", "jobage", "page", "limit", "format", "help", "h"]),
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
    const strFlag = (name: string): string | undefined | null => {
      const v = flags[name]
      if (v === undefined) return undefined
      if (typeof v !== "string" || !v.trim()) return null
      return v.trim()
    }

    const query = strFlag("query")
    if (query === null) return fail("--query requires a non-empty value", "BAD_ARG")
    const category = strFlag("category")
    if (category === null) return fail("--category requires a value", "BAD_ARG")
    if (category !== undefined && !resolveCategory(category)) {
      return fail(
        `unknown --category "${category}"; use one of: ${Object.keys(CATEGORIES).join(", ")}`,
        "BAD_ARG",
      )
    }
    if (!query && !category) {
      return fail(
        'search needs --query/-q "<keywords>" or --category <key> (WWR has no unfiltered listing endpoint)',
        "NO_QUERY",
      )
    }
    const eligible = strFlag("eligible")
    if (eligible === null) return fail("--eligible requires a country name, e.g. --eligible Canada", "BAD_ARG")
    if (flags.exact && !query) return fail("--exact needs --query", "BAD_ARG")

    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }

    const intFlag = (name: string): number | undefined | null => {
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

    const opts: SearchOpts = {
      query,
      category,
      jobage,
      eligible,
      exact: flags.exact === true,
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
