# jobbankca-cli

CLI for searching **Job Bank Canada** (https://www.jobbank.gc.ca), the Government of Canada
job board, with Job Bank's own remote / hybrid / on-site work-location filter.

**Data source**: `/jobsearch/jobsearch` (HTML results) and `/jobsearch/jobposting/<id>`
(HTML with Schema.org RDFa); city names resolve through the site's
`/core/ta-cityprovsuggest_en/select` autocomplete. See `../url-reference.md`.
**Authentication**: none.
**Dependencies**: none (plain `bun` + `fetch` + regex). `bun install` only pulls dev types.
**Politeness**: honours robots.txt `Crawl-delay: 5` — requests are spaced ≥ 5 s apart, even
across separate invocations (timestamp file in the OS temp dir).

## Installation

```bash
cd .agents/skills/jobbankca-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search postings (`--query`, `--location`, `--remote`, `--jobage`, `--page`, `--limit`, `--format`) |
| `detail` | Fetch one posting's full detail by ID or Job Bank URL |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "integration developer" --remote --format table
bun run src/cli.ts search -q "EDI" --remote --jobage 30 --format table
bun run src/cli.ts search -q "software developer" -l "Toronto, ON" --remote hybrid
bun run src/cli.ts detail 50495396 --format plain
```

## Development

```bash
bun run typecheck
bun run test        # offline parser/flag tests + one live search smoke test
```
