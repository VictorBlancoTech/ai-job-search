---
name: infojobs-search
version: 1.0.0
description: >
  Use this skill to search official InfoJobs Spain listings, especially remote,
  teleworking, IT, software, data, engineering, and professional roles, or to
  retrieve the full detail of a specific InfoJobs offer. Trigger phrases:
  search InfoJobs jobs, find jobs in Spain, Spanish remote jobs, teleworking
  jobs in Spain, buscar empleo en InfoJobs, buscar trabajo remoto en España,
  ofertas de trabajo en España, or consultar esta oferta de InfoJobs.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/infojobs-search/cli/src/cli.ts *)
---

# infojobs-search - official InfoJobs Spain API

Searches and retrieves offers through the official InfoJobs candidate API. It
does **not** scrape `infojobs.net` pages. The CLI has no runtime dependencies
beyond `bun`; TypeScript and `@types/bun` are development-only dependencies.

## Official API discovery

The endpoint and fields below were verified against the official documentation
on 2026-07-22:

- Search: `GET https://api.infojobs.net/api/1/offer`
  ([offer list documentation](https://developer.infojobs.net/documentation/operation/offer-list-9.xhtml)).
- Detail: `GET https://api.infojobs.net/api/1/offer/{offerId}`
  ([offer detail documentation](https://developer.infojobs.net/documentation/operation/offer-detail.xhtml)).
- Search parameters used by this skill: `q` for keyword, `province` for the
  `--where` value, `teleworking`, `page`, and `maxResults`. The official list
  documentation recommends `maxResults` of 50 or fewer; this CLI enforces that
  maximum. Values are URL-encoded by `URLSearchParams` and detail IDs are
  encoded as one path segment.
- `--teleworking` uses the documented `teleworking=solo-teletrabajo` value.
  The API's teleworking dictionary is documented at
  [dictionary-get-1.xhtml](https://developer.infojobs.net/documentation/operation/dictionary-get-1.xhtml).
- Search responses have an `{ offers, currentPage, pageSize, totalResults,
  currentResults, totalPages, ... }` envelope. Offers expose `id`, `title`,
  `link`, `city`, `province.value`, `author.name`, `updated`, `published`,
  `teleworking.value`, `salaryMin.value`, `salaryMax.value`,
  `salaryPeriod.value`, and `requirementMin`.
- Detail responses are a single offer object. The documented and observed
  detail shape includes `id`, `title`, `link`, `city`, `provinceValue`,
  `author` or `profile`, `description`, `creationDate`/`updateDate`,
  `minRequirements`, `desiredRequirements`, teleworking, and salary fields.

The official pages do not publish a numeric public rate limit. The CLI sends a
descriptive `User-Agent`, uses a 20-second timeout, and retries once after HTTP
429, HTTP 5xx, or a connection failure. Use the API fairly; do not poll
aggressively, bulk-harvest, or bypass access controls.

## Credentials

Create or manage an InfoJobs developer application through the
[InfoJobs Developer site](https://developer.infojobs.net/) and configure the
values in the workspace `.env` (that file is gitignored):

```dotenv
INFOJOBS_CLIENT_ID=your-client-id
INFOJOBS_CLIENT_SECRET=your-client-secret
```

Every request uses HTTP Basic authentication with
`base64(INFOJOBS_CLIENT_ID:INFOJOBS_CLIENT_SECRET)` in the `Authorization`
header. The credentials are never included in stdout or structured errors. If
either variable is blank, the command exits `2` and writes
`{"error":"...","code":"NO_CREDENTIALS"}` to stderr without making a
request.

## Commands

Run from the workspace root:

```bash
bun run .agents/skills/infojobs-search/cli/src/cli.ts search --query "responsable IT" --where "Madrid" --limit 10 --format table
bun run .agents/skills/infojobs-search/cli/src/cli.ts search -q "ingeniero de datos" --teleworking --format json
bun run .agents/skills/infojobs-search/cli/src/cli.ts detail <offer-id> --format plain
```

### Search flags

- `--query <text>` / `-q` is required and maps to API `q`.
- `--where <location>` / `-l` is optional and maps to API `province`. It is
  sent as the documented province value; the CLI does not guess country or
  city dictionary IDs.
- `--teleworking` is a boolean server-side filter for offers marked
  `solo-teletrabajo`.
- `--page <n>` is a 1-indexed integer, `>= 1`; default `1`.
- `--limit <n>` / `-n` is an integer from `1` to `50`; default `50`, sent as
  `maxResults`.
- `--format json|table|plain` defaults to `json` and is strict.

### Detail flags

- `detail <id>` fetches one offer using the same Basic authentication.
- `--format json|table|plain` is supported; JSON is the complete normalized
  detail object and contains the full `description` when the API provides it.

## JSON contract

Search JSON is a complete envelope:

```json
{
  "meta": {
    "portal": "infojobs",
    "count": 1,
    "query": "responsable IT",
    "location": "Madrid"
  },
  "results": [
    {
      "id": "stable-offer-id",
      "portal": "infojobs",
      "title": "Responsable IT",
      "company": "Example",
      "location": "Madrid",
      "url": "https://www.infojobs.net/example/offer/of-stable-offer-id",
      "date": "2026-07-22",
      "description": "HTML-stripped summary or requirement",
      "remote": true,
      "salary": "30.000 €-40.000 € Bruto/año"
    }
  ]
}
```

`detail` JSON is one object with the same normalized fields, not a search
envelope. `date` is always strict `YYYY-MM-DD` or `null`; impossible dates are
`null`. `description` strips tags while retaining readable line breaks and
decoding safe named/numeric entities. Search prefers `description`/summary and
then `requirementMin`; detail prefers the full `description` and falls back to
requirements when necessary. `company`, `location`, and all malformed optional
fields become `null` or an empty description. Rows without a usable ID, title,
or URL are skipped rather than fabricated.

`remote` is `true` only for explicit remote/teleworking labels, `false` only
for explicit onsite/presencial labels, and `null` for unknown labels. `salary`
is populated only from explicit numeric min/max/range data and its documented
period; a period by itself never becomes a salary.

Table and plain output are human-readable summaries. JSON is the only complete
machine-oriented output. All errors are JSON on stderr:

```json
{"error":"message","code":"INVALID_ARGUMENT"}
```

Invalid arguments and missing credentials exit `2`. API, malformed-response,
and detail failures exit `1` with `SEARCH_FAILED` or `DETAIL_FAILED`.

## Tests

Fixtures are sanitized and network-free:

```bash
cd .agents/skills/infojobs-search/cli
bun test
bun run typecheck
```
