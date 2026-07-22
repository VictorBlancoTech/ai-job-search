#!/usr/bin/env bun

import { runSearch, type SearchOpts } from "./commands/search.js"
import {
  booleanFlag,
  integerFlag,
  InvalidArgumentError,
  parseArgs,
  stringFlag,
  writeError,
  type ErrorWriter,
  type Flags,
} from "./helpers.js"

const HELP = `arbeitnow-search-cli - search the public Arbeitnow job board API

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [flags]

SEARCH FLAGS
  --query, -q <text>       Local whole-token search. Optional.
  --remote-only            Keep jobs whose API remote field is true.
  --page <n>               API page, integer >= 1. Default 1.
  --limit, -n <n>          Results after local filters, 1..100. Default 50.
  --format <fmt>           json (default) | table | plain.

The public API needs no key. Results are strongest for DACH and remote-EU roles.
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
      remoteOnly: booleanFlag(flags, "remote-only"),
      page: integerFlag("page", stringFlag(flags, "page") ?? "1", 1),
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
