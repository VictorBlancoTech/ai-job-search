#!/usr/bin/env bun

import { runSearch, parseCategories, type SearchOpts, type Source } from "./commands/search.js"
import {
  DEFAULT_CATEGORIES,
  InvalidArgumentError,
  integerFlag,
  parseArgs,
  stringFlag,
  stringValuesFlag,
  writeError,
  type ErrorWriter,
  type Flags,
} from "./helpers.js"

const HELP = `wwr-search-cli - search WWR RSS and Himalayas public remote jobs

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [flags]

SEARCH FLAGS
  --query, -q <text>       Local whole-token AND search. Optional.
  --source <name>          wwr | himalayas | both (default both).
  --category <slug>        Repeatable/comma-separated WWR RSS category.
  --limit, -n <n>          Results after merge and local filters, 1..100. Default 50.
  --format <fmt>           json (default) | table | plain.

Sources
  WWR: https://weworkremotely.com/categories/<category>.rss
  Himalayas: https://himalayas.app/jobs/api
`

function formatFlag(flags: Flags): "json" | "table" | "plain" {
  const format = stringFlag(flags, "format") ?? "json"
  if (format !== "json" && format !== "table" && format !== "plain") {
    throw new InvalidArgumentError(`--format must be json, table, or plain, got "${format}"`)
  }
  return format
}

function sourceFlag(flags: Flags): Source {
  const source = stringFlag(flags, "source") ?? "both"
  if (source !== "wwr" && source !== "himalayas" && source !== "both") {
    throw new InvalidArgumentError(`--source must be wwr, himalayas, or both, got "${source}"`)
  }
  return source
}

function categoryFlag(flags: Flags): string[] {
  const values = stringValuesFlag(flags, "category")
  try {
    return parseCategories(values.length > 0 ? values : [...DEFAULT_CATEGORIES])
  } catch (error) {
    if (error instanceof InvalidArgumentError) throw error
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error))
  }
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
      source: sourceFlag(flags),
      categories: categoryFlag(flags),
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
