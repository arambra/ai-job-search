# Fixtures

Captured live from weworkremotely.com on 2026-11-01 with the CLI's User-Agent, then trimmed:

- `search-cards.html` — the first six `<li ... new-listing-container ...>` cards (five jobs plus
  one paid "Promoted" ad card) from `https://weworkremotely.com/remote-jobs/search?term=developer`.
- `detail-legion-excerpt.html` — the JSON-LD `JobPosting` script plus the header, description and
  "About the job" sidebar of `https://weworkremotely.com/remote-jobs/legion-senior-integration-engineer`
  (the rest of the page — nav, ads, footer — removed).

Re-capture these if WWR changes its markup; `../../../url-reference.md` lists the anchors the parsers use.
