#!/usr/bin/env bun

import { runDetail, runSearch, type DetailOpts, type SearchOpts } from "./commands/index.js"
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

const HELP = `infojobs-search-cli - search InfoJobs Spain through the official API

USAGE
  bun run src/cli.ts search --query "<text>" [flags]
  bun run src/cli.ts detail <id> [--format json|table|plain]

SEARCH FLAGS
  --query, -q <text>       Required keyword sent as API q.
  --where, -l <location>   Optional location sent as API province.
  --teleworking            Request solo-teletrabajo offers.
  --page <n>               1-indexed API page. Default 1.
  --limit, -n <n>          Results per page, 1..50. Default 50.
  --format <fmt>           json (default) | table | plain.

DETAIL
  <id>                     InfoJobs offer id from a search result.

AUTHENTICATION
  INFOJOBS_CLIENT_ID and INFOJOBS_CLIENT_SECRET are required.
  API documentation: https://developer.infojobs.net/
`

function formatFlag(flags: Flags): "json" | "table" | "plain" {
  const format = stringFlag(flags, "format") ?? "json"
  if (format !== "json" && format !== "table" && format !== "plain") {
    throw new InvalidArgumentError(`--format must be json, table, or plain, got "${format}"`)
  }
  return format
}

function rejectUnsupportedFlags(flags: Flags, allowed: Set<string>): void {
  for (const key of Object.keys(flags)) {
    if (key !== "_" && !allowed.has(key)) throw new InvalidArgumentError(`option "--${key}" is not valid for this command`)
  }
}

function requiredTextFlag(flags: Flags, name: string): string {
  const value = stringFlag(flags, name)
  if (value === undefined || !value.trim()) throw new InvalidArgumentError(`--${name} requires non-empty text`)
  return value
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
    if (!command) throw new InvalidArgumentError('missing command: expected "search" or "detail"')

    if (command === "search") {
      rejectUnsupportedFlags(flags, new Set(["_", "query", "where", "teleworking", "page", "limit", "format", "help", "h"]))
      if (positional.length > 1) throw new InvalidArgumentError(`unexpected argument "${positional[1]}"`)
      const where = stringFlag(flags, "where")
      if (where !== undefined && !where.trim()) throw new InvalidArgumentError("--where requires non-empty text")
      const opts: SearchOpts = {
        query: requiredTextFlag(flags, "query"),
        where,
        teleworking: booleanFlag(flags, "teleworking"),
        page: integerFlag("page", stringFlag(flags, "page") ?? "1", 1),
        limit: integerFlag("limit", stringFlag(flags, "limit") ?? "50", 1, 50),
        format: formatFlag(flags),
      }
      return runSearch(opts, { writeError: emitError })
    }

    if (command === "detail") {
      rejectUnsupportedFlags(flags, new Set(["_", "format", "help", "h"]))
      if (positional.length !== 2 || !positional[1]?.trim()) {
        throw new InvalidArgumentError('detail requires exactly one non-empty <id>')
      }
      const opts: DetailOpts = { id: positional[1]!, format: formatFlag(flags) }
      return runDetail(opts, { writeError: emitError })
    }

    throw new InvalidArgumentError(`unknown command "${command}"`)
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
