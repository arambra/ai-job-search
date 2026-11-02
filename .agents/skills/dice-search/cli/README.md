# dice-cli

Search US tech jobs on [Dice](https://www.dice.com) from the command line. Zero runtime
dependencies - plain `bun` + `fetch` + regex/JSON parsing. `bun install` only pulls the
dev types used by `bun run typecheck`.

**Personal use only.** dice.com's `robots.txt` disallows the search and job-detail paths this
CLI reads. Keep volume low; no commercial or bulk use; your own responsibility.

## Usage

```bash
bun run src/cli.ts search -q "integration developer" --remote remote --format table
bun run src/cli.ts search -q "EDI" --remote remote --jobage 7 --limit 10
bun run src/cli.ts detail a7f7c2dd-df6c-48d3-85b5-c3afa257a72d --format plain
bun run src/cli.ts --help
```

Search flags: `--query/-q` (required), `--remote remote|hybrid|onsite`, `--jobage <days>`,
`--location/-l <place>`, `--page <n>`, `--limit/-n <n>`, `--format json|table|plain`.

## How it works

- **Search** fetches `https://www.dice.com/jobs?q=...` and reads the job list Dice embeds in
  the Next.js flight payload (`self.__next_f.push(...)` -> `"jobList":{"data":[...]}`). Each job
  object is parsed independently, so one malformed entry cannot break the rest.
- **Detail** fetches `https://www.dice.com/job-detail/<guid>` and reads the schema.org
  `JobPosting` JSON-LD plus the header badges (workplace, employment types, duration).

See `../url-reference.md` for the parameters and parsing anchors.

## Development

```bash
bun install
bun run typecheck
bun run test   # offline parser/flag tests + one live search and one live detail request
```
