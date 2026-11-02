# remotive-cli

CLI for searching [Remotive](https://remotive.com), a remote-only job board, via
its official public API.

**Data source**: `GET https://remotive.com/api/remote-jobs` ([docs](https://github.com/remotive-com/remote-jobs-api)).
**Authentication**: none.
**Dependencies**: none at runtime (plain `bun` + `fetch`); `bun install` only pulls dev types.

> **Terms**: credit Remotive and keep the Remotive job URL; listings are delayed 24 h;
> max ~4 API calls a day advised, >2/min blocked. The CLI makes one request per
> command and caches responses for 6 h. See `../SKILL.md` ("Terms & limits") and
> `../url-reference.md`.

## Installation

```bash
cd .agents/skills/remotive-search/cli
bun install   # optional - TypeScript dev types only
```

## Commands

| Command | Description |
|---------|-------------|
| `search [-q <text>] [--country <name>] [--category <slug>] [--company <name>] [--jobage <days>] [--page <n>] [--limit <n>] [--no-description] [--format json\|table\|plain]` | One API request, client-side filtering and paging |
| `detail <id\|url> [--format json\|plain]` | One posting, resolved from a cached or single job-list response |

```bash
bun run src/cli.ts search -q "developer" --country canada --limit 5 --format table
bun run src/cli.ts detail 2091135 --format plain
```

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `REMOTIVE_CACHE_TTL_MIN` | `360` | Response cache lifetime in minutes; `0` disables |
| `REMOTIVE_CACHE_DIR` | `<tmp>/remotive-cli-cache` | Cache location |
| `REMOTIVE_API_URL` | `https://remotive.com` | Base URL (tests point it at a local fixture server) |
| `REMOTIVE_SKIP_LIVE` | unset | `1` skips the single live smoke test |

## Tests

```bash
bun run typecheck
bun run test
```

`tests/commands.test.ts` runs every command against a local server serving
`tests/fixtures/remote-jobs.json` (a trimmed real response), so it makes no calls to
Remotive. `tests/live.test.ts` makes exactly one live request (`-q developer`).
