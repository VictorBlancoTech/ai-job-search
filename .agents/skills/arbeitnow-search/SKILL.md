---
name: arbeitnow-search
version: 1.0.0
description: >
  Use this skill to search live jobs through Arbeitnow's public job-board API,
  with a useful bias toward DACH, German-speaking Europe, and remote-EU roles.
  Trigger phrases: find a job, search for jobs, German jobs, DACH jobs, remote
  EU jobs, Arbeitnow openings, buscar empleo, buscar trabajo, ofertas de empleo,
  ofertas de trabajo, or buscar puestos en Alemania.
context: fork
enabled: true  # set to false to keep this portal installed but have /job-scrape skip it
allowed-tools: Bash(bun run .agents/skills/arbeitnow-search/cli/src/cli.ts *)
---

# arbeitnow-search - public DACH and remote-EU job API

Searches live job listings through the **[Arbeitnow public job-board API](https://www.arbeitnow.com/api/job-board-api)**.
The API requires no account, credential, or API key. The CLI has no runtime
dependencies beyond `bun`.

## Scope and fair use

- Arbeitnow is especially useful for German-speaking Europe, DACH, and remote-EU
  roles, but the API does not guarantee a geographic scope for every result.
- The CLI sends an identifying User-Agent and makes one API request per command.
- Use the public API fairly: avoid polling, bulk harvesting, and aggressive
  repeated searches. Respect Arbeitnow's API terms and link back to the source
  when presenting results outside the application pipeline.
- The endpoint returns up to 100 jobs per API page. This skill does not fetch
  additional pages to fill a local limit.

## Command

```bash
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search [flags]
```

Flags:

- `--query <text>` / `-q` - optional local whole-token AND search across title,
  company, tags, HTML-stripped description, and location. Matching ignores case
  and diacritics; an empty query matches all jobs.
- `--remote-only` - keep only entries whose API `remote` field is exactly
  `true`; unknown or malformed values are not treated as remote.
- `--page <n>` - 1-indexed API page, integer `>= 1`; default `1`.
- `--limit <n>` / `-n` - integer `1..100`, applied after local filters; default
  `50`.
- `--format json|table|plain` - default `json`. Any other value is invalid.

The query is sent as an optional server-side hint when present, but local
token filtering is authoritative because public API filtering is not a stable
contract. A page with fewer local matches is returned as-is; the CLI never
fabricates cross-page pagination.

Examples:

```bash
# AI consultant roles in the current API page, filtering locally
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search -q "AI consultant" --limit 5

# Remote-only jobs as a human-readable table
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search --remote-only --format table

# Inspect the second API page
bun run .agents/skills/arbeitnow-search/cli/src/cli.ts search --page 2 --format plain
```

## JSON contract

`--format json` returns the complete pipeline payload:

```json
{
  "meta": { "portal": "arbeitnow", "count": 1, "query": "AI consultant", "location": null },
  "results": [
    {
      "id": "stable-slug",
      "portal": "arbeitnow",
      "title": "AI Consultant",
      "company": "Example GmbH",
      "location": "Berlin",
      "url": "https://www.arbeitnow.com/jobs/example/ai-consultant",
      "date": "2026-07-22",
      "description": "HTML stripped string",
      "remote": true,
      "salary": null
    }
  ]
}
```

- `id` uses `slug`; when absent it falls back to a stable API id or URL. Rows
  without a string title or stable URL are skipped.
- `date` normalizes numeric epoch seconds or strict ISO input to `YYYY-MM-DD`.
  Missing, impossible, and garbage dates become `null` rather than being
  rolled over by JavaScript date parsing.
- `description` is always a string with HTML tags removed and common/numeric
  entities decoded safely.
- `company`, `location`, `date`, `remote`, and `salary` become `null` when the
  API does not provide a valid value. Arbeitnow currently exposes no salary
  field, so salary is never inferred and remains `null`.
- `table` and `plain` are human-readable summaries and may omit long fields;
  JSON is the complete contract.
- Errors are JSON on stderr as `{ "error": "...", "code": "..." }`.
  Invalid flags exit with code `2`; API, envelope, and search failures exit
  with code `1`.

## Tests

```bash
cd .agents/skills/arbeitnow-search/cli
bun test
bun run typecheck
```

Tests use `cli/tests/fixtures/search.json`, a small real response sample with
the live `data`, `links`, and `meta` envelope, and do not access the network.
