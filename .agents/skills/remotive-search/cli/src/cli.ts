#!/usr/bin/env bun

import { runSearch, type SearchOpts } from "./commands/search.js"
import {
  integerFlag,
  InvalidArgumentError,
  parseArgs,
  stringFlag,
  writeError,
  type ErrorWriter,
  type Flags,
} from "./helpers.js"

const HELP = `remotive-search-cli - search the public Remotive remote jobs API

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [--category "<category>"] [flags]

SEARCH FLAGS
  --query, -q <text>       Search keywords. Optional.
  --limit, -n <n>          Results to request, 1..100. Default 50.
  --category <text>        Remotive category. Optional.
  --format <fmt>           json (default) | table | plain.

The API is global and every result is remote. Filter by country or location in
/rank rather than in this CLI. No credentials are required.
`

function formatFlag(flags: Flags): "json" | "table" | "plain" {
  const format = stringFlag(flags, "format") ?? "json"
  if (format !== "json" && format !== "table" && format !== "plain") {
    throw new InvalidArgumentError(`--format must be json, table, or plain, got "${format}"`)
  }
  return format
}

export async function main(argv = process.argv.slice(2), emitError: ErrorWriter = writeError): Promise<number> {
  try {
    const flags = parseArgs(argv)
    const positional = flags._ as string[]
    const command = positional[0]

    if (flags.help || flags.h) {
      process.stdout.write(HELP)
      return 0
    }
    if (!command) throw new InvalidArgumentError('missing command: expected "search"')
    if (command !== "search") throw new InvalidArgumentError(`unknown command "${command}"`)
    if (positional.length > 1) throw new InvalidArgumentError(`unexpected argument "${positional[1]}"`)

    const opts: SearchOpts = {
      query: stringFlag(flags, "query"),
      category: stringFlag(flags, "category"),
      limit: integerFlag("limit", stringFlag(flags, "limit") ?? "50", 1, 100),
      format: formatFlag(flags),
    }
    return runSearch(opts)
  } catch (error) {
    if (error instanceof InvalidArgumentError) {
      emitError(error.message, error.code)
      return 2
    }
    throw error
  }
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      writeError(error instanceof Error ? error.message : String(error), "INTERNAL_ERROR")
      process.exit(1)
    })
}
