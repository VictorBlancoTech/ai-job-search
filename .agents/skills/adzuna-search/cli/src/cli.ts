#!/usr/bin/env bun
// Self-contained CLI for searching the official Adzuna Jobs API (Italy + Spain
// with one client). No external CLI framework and zero runtime dependencies,
// so it runs anywhere `bun` is available with nothing installed beyond the
// repo clone. Credentials come from ADZUNA_APP_ID / ADZUNA_APP_KEY (environment
// or the repo-root .env); missing credentials exit with code 2.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { parseArgs, writeError } from "./helpers.js"

const HELP = `adzuna-search-cli — search the official Adzuna Jobs API (portals: it, es)

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [-l "<location>"] [--country it|es] [flags]

SEARCH FLAGS
  --query, -q <text>      Keywords (title, description). Optional.
  --where, -l <text>      Location (city, region). Optional.
  --country <code>        Adzuna portal: it (default) | es.
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Results per page (API max 50). Default 25.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "responsabile it" -l "Bologna" --country it --format table
  bun run src/cli.ts search -q "responsable it" --country es --limit 10 --format json

Auth: ADZUNA_APP_ID / ADZUNA_APP_KEY (free at https://developer.adzuna.com/).
Free tier: 25 calls/minute, 250 calls/day. Descriptions come inline with
search results — there is no separate detail command.
`

function parseIntFlag(name: string, raw: string | boolean | string[]): number | null {
  const val = parseInt(raw as string, 10)
  if (isNaN(val)) {
    writeError(`--${name} must be a number, got "${raw}"`, "BAD_ARG")
    return null
  }
  return val
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseArgs(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  if (cmd === "search") {
    for (const name of ["page", "limit"] as const) {
      if (flags[name] !== undefined) {
        const v = parseIntFlag(name, flags[name])
        if (v === null) return 1
        flags[name] = String(v)
      }
    }

    const country = ((flags.country as string) || "it").toLowerCase()
    if (country !== "it" && country !== "es") {
      writeError(`--country must be "it" or "es", got "${flags.country}"`, "BAD_ARG")
      return 1
    }

    const fmt = (flags.format as string) || "json"
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      where: typeof flags.where === "string" ? flags.where : undefined,
      country,
      page: flags.page ? Math.max(1, parseInt(flags.page as string, 10)) : 1,
      limit: flags.limit ? Math.max(1, parseInt(flags.limit as string, 10)) : 25,
      format: (["json", "table", "plain"].includes(fmt) ? fmt : "json") as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  writeError(`Unknown command "${cmd}"`, "BAD_CMD")
  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
    process.exit(1)
  })
