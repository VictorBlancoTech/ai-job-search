#!/usr/bin/env bun
// Self-contained CLI for searching the official Adzuna Jobs API (Italy + Spain
// with one client). No external CLI framework and zero runtime dependencies,
// so it runs anywhere `bun` is available with nothing installed beyond the
// repo clone. Credentials come from ADZUNA_APP_ID / ADZUNA_APP_KEY (environment
// or the repo-root .env); missing credentials exit with code 2.

import { runSearch, type SearchOpts } from "./commands/search.js"
import {
  InvalidArgumentError,
  parseArgs,
  writeError,
  type ErrorWriter,
  type Flags,
} from "./helpers.js"

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

    const opts: SearchOpts = {
      query: stringFlag(flags, "query"),
      where: stringFlag(flags, "where"),
      country,
      page: integerFlag("page", stringFlag(flags, "page") ?? "1", 1),
      limit: integerFlag("limit", stringFlag(flags, "limit") ?? "25", 1, 50),
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
