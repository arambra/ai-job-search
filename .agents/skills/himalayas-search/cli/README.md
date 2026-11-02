# himalayas-cli

CLI for searching remote jobs on [Himalayas](https://himalayas.app) through its free
public [Remote Jobs API](https://himalayas.app/api), with each job's country eligibility.

**Data source**: `GET /jobs/api/search` (search) and `GET /jobs/api/companies/{company}/jobs/{slug}` (detail).
**Authentication**: None required. Optional free key via the `HIMALAYAS_API_TOKEN` env var for a higher rate limit.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` only pulls dev type definitions.

## Installation

```bash
cd .agents/skills/himalayas-search/cli
bun install   # optional - only TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search [-q <text>] [--country CA] [filters]` | Search remote jobs; see `--help` for every flag |
| `detail <company/slug\|url>` | One job with its full description; exits 1 with `JOB_CLOSED` if it has closed |

```bash
bun run src/cli.ts search -q "integration developer" --country CA --format table
bun run src/cli.ts search -q "EDI" --country Canada --jobage 14 --format json
bun run src/cli.ts detail unlimited-potential/integration-developer --format plain
```

## Tests

```bash
bun run typecheck
bun run test   # unit tests (mocked fetch) + one live smoke request
```

See `../SKILL.md` for the output fields and `../url-reference.md` for the API details,
rate limits and terms.
