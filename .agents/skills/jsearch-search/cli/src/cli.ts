#!/usr/bin/env bun
// Self-contained CLI for searching the JSearch API (OpenWebNinja)
// (https://www.openwebninja.com/jsearch). The API key comes from the
// environment or the repo-root .env; a missing key exits with code 2.
// No external CLI framework and zero runtime dependencies, so it runs
// anywhere `bun` is available with nothing installed beyond the repo clone.

import { runSearch, type SearchOpts } from "./commands/search.js"
import {
  InvalidArgumentError,
  parseArgs,
  writeError,
  type ErrorWriter,
  type Flags,
} from "./helpers.js"

const HELP = `jsearch-search-cli — search the JSearch API / OpenWebNinja (countries: it, es)

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [-l "<location>"] [--country it|es] [flags]

SEARCH FLAGS
  --query, -q <text>      Keywords (title, description). Optional but recommended.
  --where, -l <text>      Location — folded into the query ("kw in loc"). Optional.
  --country <code>        ISO country code: it (default) | es.
  --page <n>              1-indexed page. Default 1.
  --limit, -n <n>         Results (API returns ~10/page; max 20). Default 10.
  --remote                Only remote jobs (remote_jobs_only=true).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "IT Manager" -l "Bologna" --country it
  bun run src/cli.ts search -q "AI consultant" --country es --remote --limit 20

Auth: JSEARCH_API_KEY from the environment or the repo-root .env. The free
tier allows ~200 requests/month; a warning is printed when fewer than 20
remain. There is no separate detail command.
`

function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags[name]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new InvalidArgumentError(`--${name} requires a string value`)
  return value
}

function integerFlag(name: string, raw: string | undefined, min: number, max?: number): number {
  const range = max === undefined ? `>= ${min}` : `${min}..${max}`
  if (raw === undefined || !/^\d+$/.test(raw)) {
    if (raw !== undefined && /^-\d+$/.test(raw)) {
      throw new InvalidArgumentError(`--${name} must be in the range ${range}, got "${raw}"`)
    }
    throw new InvalidArgumentError(`--${name} must be a non-negative integer, got "${raw ?? ""}"`)
  }
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
    throw new InvalidArgumentError(`--${name} must be in the range ${range}, got "${raw}"`)
  }
  return value
}

export async function main(argv = process.argv.slice(2), emitError: ErrorWriter = writeError): Promise<number> {
  try {
    const flags = parseArgs(argv)
    const positional = flags._ as string[]
    const cmd = positional[0]

    if (flags.help || flags.h) {
      process.stdout.write(HELP)
      return 0
    }
    if (!cmd) throw new InvalidArgumentError("missing command: expected \"search\"")
    if (cmd !== "search") throw new InvalidArgumentError(`unknown command "${cmd}"`)
    if (positional.length > 1) throw new InvalidArgumentError(`unexpected argument "${positional[1]}"`)

    const country = stringFlag(flags, "country") ?? "it"
    if (country !== "it" && country !== "es") {
      throw new InvalidArgumentError(`--country must be "it" or "es", got "${country}"`)
    }

    const fmt = stringFlag(flags, "format") ?? "json"
    if (fmt !== "json" && fmt !== "table" && fmt !== "plain") {
      throw new InvalidArgumentError(`--format must be json, table, or plain, got "${fmt}"`)
    }

    const query = stringFlag(flags, "query")
    const where = stringFlag(flags, "where")
    if (!query && !where) {
      throw new InvalidArgumentError("missing search criteria: pass -q and/or -l")
    }

    const opts: SearchOpts = {
      query,
      where,
      country,
      page: integerFlag("page", stringFlag(flags, "page") ?? "1", 1),
      limit: integerFlag("limit", stringFlag(flags, "limit") ?? "10", 1, 20),
      remote: flags.remote === true,
      format: fmt,
    }
    return runSearch(opts)
  } catch (e) {
    if (e instanceof InvalidArgumentError) {
      emitError(e.message, e.code)
      return 2
    }
    throw e
  }
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      writeError(e instanceof Error ? e.message : String(e), "INTERNAL_ERROR")
      process.exit(1)
    })
}
