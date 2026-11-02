# weworkremotely-cli

CLI for searching remote jobs on **We Work Remotely** (https://weworkremotely.com), a
remote-only job board, with each job's **region / applicant eligibility** exposed as a field.

**Data source**: WWR's public server-rendered pages — `/remote-jobs/search?term=`, `/categories/<slug>`, `/remote-jobs/<slug>`.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional and only pulls dev type defs.

## Installation

```bash
cd .agents/skills/weworkremotely-search/cli
bun install   # optional — only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search listings (`--query` and/or `--category` required) |
| `detail` | Fetch full detail for one listing (slug or URL) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "integration" --eligible Canada --format table
bun run src/cli.ts search -q "EDI" --exact --format table
bun run src/cli.ts search -c devops-sysadmin --eligible Canada --jobage 7 --format table
bun run src/cli.ts detail legion-senior-integration-engineer --format plain
```

## Tests

```bash
bun run typecheck
bun run test   # offline parser tests on live-captured fixtures + one live search/detail smoke test
```

The live smoke test searches `developer` rather than a niche term, because narrow queries
(e.g. `integration developer`) can legitimately return zero results on WWR.

See `../SKILL.md` for the full flag reference and `../url-reference.md` for endpoint and markup notes.
