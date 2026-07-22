---
name: wwr-search
version: 1.0.0
description: >
  Use this skill to search worldwide remote job listings across We Work Remotely
  RSS and the Himalayas public JSON API, especially programming, technology,
  product, management, and operations roles. Trigger phrases: find worldwide
  remote jobs, remote tech jobs, remote programming jobs, remote management jobs,
  remote product jobs, remote vacancies, or buscar empleo remoto global.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/wwr-search/cli/src/cli.ts *)
---

# wwr-search - WWR RSS plus Himalayas public API

Searches two public remote-job sources with one CLI and one unified result
contract:

```bash
bun run .agents/skills/wwr-search/cli/src/cli.ts search [flags]
```

## Sources and discovery status

- **We Work Remotely (WWR)** uses the public RSS feeds at
  `https://weworkremotely.com/categories/<category>.rss`. Live discovery on
  2026-07-22 returned `200 application/rss+xml` for
  `remote-programming-jobs`, `remote-management-and-finance-jobs`,
  `remote-product-jobs`, and `remote-devops-sysadmin-jobs`. The default is the
  first two categories to keep the default request volume bounded. The CLI
  allowlist is exactly those four verified slugs; unknown or invented category
  values are rejected as `INVALID_ARGUMENT` before any request is made.
- WWR is fetched with a descriptive User-Agent, a 20-second timeout, and at
  most one retry for HTTP 429 or 5xx responses. Use the RSS feeds fairly: no
  aggressive polling, bulk harvesting, or bypassing access controls. Keep the
  result URL and identify WWR when presenting listings outside the pipeline.
- **Himalayas** was initially checked at
  `https://himalayas.app/api/jobs?limit=3`; it returned `404` HTML. The public
  documentation at `https://himalayas.app/docs/remote-jobs-api` identifies the
  verified endpoint `https://himalayas.app/jobs/api`, which returned `200
  application/json` with `jobs`, `totalCount`, `pubDate`, `applicationLink`,
  `guid`, location restrictions, and salary fields. It requires no account,
  authentication, or API key. Its documented maximum is 20 jobs per request;
  the CLI makes bounded pagination requests up to the requested 1..100 limit.
- Both sources are remote-only and every mapped result has `remote: true`.
  Himalayas empty `locationRestrictions` is represented as `Worldwide`; WWR
  missing region is represented as `Remote`.
- `--source himalayas` returns a structured `SOURCE_UNAVAILABLE` error when
  the endpoint or response is unavailable. Default `both` is best effort and
  continues with the source that remains available. If both sources fail, the
  command exits 1 with a structured source error.

## Flags

- `--query <text>` / `-q` is optional local whole-token AND filtering across
  title, company, description, and location. Matching ignores case and
  diacritics; `care` does not match `Healthcare`. Empty query matches all.
- `--source wwr|himalayas|both` selects sources; default `both`.
- `--category <slug>` is repeatable or comma-separated and applies to WWR.
  Allowed slugs: `remote-programming-jobs`,
  `remote-management-and-finance-jobs`, `remote-product-jobs`, and
  `remote-devops-sysadmin-jobs`. Default:
  `remote-programming-jobs,remote-management-and-finance-jobs`.
- `--limit <n>` / `-n` accepts integers `1..100` and is applied after source
  merging and local filtering; default `50`.
- `--format json|table|plain` defaults to `json`. Invalid flags exit `2`.

## JSON contract

JSON is the complete pipeline payload:

```json
{
  "meta": {
    "portal": "wwr-search",
    "count": 1,
    "query": "AI consultant",
    "location": null,
    "sources": ["wwr", "himalayas"]
  },
  "results": [
    {
      "id": "stable-source-id",
      "portal": "wwr",
      "title": "AI Consultant",
      "company": "Example",
      "location": "Worldwide",
      "url": "https://example.test/jobs/ai-consultant",
      "date": "2026-07-22",
      "description": "HTML-stripped description",
      "remote": true,
      "salary": null
    }
  ]
}
```

- WWR titles are split at the first colon as `Company: Role`; titles without a
  colon have `company: null`. WWR IDs are SHA-256 hashes of normalized links.
- Himalayas IDs use the API id, slug, GUID, or URL in that order. Explicit
  salary bounds are preserved as a string with currency and pay period; salary
  is `null` when no explicit bounds exist.
- Dates are normalized strictly to `YYYY-MM-DD`; impossible or malformed dates
  become `null` rather than rolling over. Descriptions strip HTML, preserve
  readable breaks, and decode safe named/numeric entities.
- `table` and `plain` are human-readable summaries. They attribute only
  successfully queried sources. Under `both`, a failed source is shown as
  `Unavailable` while the available source remains the active attribution;
  JSON retains every unified result field and lists only active sources in
  `meta.sources`.
- Errors are JSON on stderr as `{ "error": "...", "code": "..." }`.
  Invalid arguments use exit `2`; source/API and response failures use exit `1`.

## Tests

```bash
cd .agents/skills/wwr-search/cli
bun test
bun run typecheck
```

Fixtures cover RSS CDATA, quoted attributes, `<br>`, entities, malformed and
duplicate items, missing links, strict dates, and the verified Himalayas
response shape. Tests do not access the network.
