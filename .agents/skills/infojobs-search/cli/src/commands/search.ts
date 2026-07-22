import {
  apiGet,
  INFOJOBS_SEARCH_ENDPOINT,
  normalizeProvince,
  requireCredentials,
  toResult,
  jobsFromResponse,
  writeError,
  type ApiGetOptions,
  type Credentials,
  type Environment,
  type ErrorWriter,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query: string
  where?: string
  teleworking: boolean
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

export interface SearchDependencies {
  writeError?: ErrorWriter
  credentials?: Credentials
  env?: Environment
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
  retryDelayMs?: number
  timeoutMs?: number
}

export function buildSearchUrl(opts: SearchOpts): string {
  const url = new URL(INFOJOBS_SEARCH_ENDPOINT)
  const params = url.searchParams
  if (opts.query.trim()) params.set("q", opts.query)
  if (opts.where?.trim()) params.set("province", normalizeProvince(opts.where))
  if (opts.teleworking) params.set("teleworking", "solo-teletrabajo")
  params.set("page", String(opts.page))
  params.set("maxResults", String(opts.limit))
  return url.toString()
}

function apiOptions(dependencies: SearchDependencies, credentials: Credentials): ApiGetOptions {
  return {
    credentials,
    fetchFn: dependencies.fetchFn,
    sleepFn: dependencies.sleepFn,
    retryDelayMs: dependencies.retryDelayMs,
    timeoutMs: dependencies.timeoutMs,
  }
}

function shortDate(date: string | null): string {
  return date ?? "-"
}

function remoteLabel(remote: boolean | null): string {
  return remote === true ? "yes" : remote === false ? "no" : "-"
}

interface Column {
  header: string
  width: number
  cell: (result: JobResult) => string
}

export function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "portal: infojobs\nNo results."
  const columns: Column[] = [
    { header: "ID", width: 20, cell: (result) => result.id },
    { header: "TITLE", width: 34, cell: (result) => result.title },
    { header: "COMPANY", width: 22, cell: (result) => result.company ?? "-" },
    { header: "LOCATION", width: 24, cell: (result) => result.location ?? "-" },
    { header: "DATE", width: 10, cell: (result) => shortDate(result.date) },
    { header: "REMOTE", width: 6, cell: (result) => remoteLabel(result.remote) },
    { header: "SALARY", width: 24, cell: (result) => result.salary ?? "-" },
  ]
  const row = (cells: string[]) =>
    cells.map((cell, index) => cell.slice(0, columns[index].width).padEnd(columns[index].width)).join("  ")
  const header = row(columns.map((column) => column.header))
  return ["portal: infojobs", header, "-".repeat(header.length), ...rows.map((result) => row(columns.map((column) => column.cell(result))))].join("\n")
}

export function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "portal: infojobs\nNo results."
  const block = (result: JobResult) =>
    [
      `portal: ${result.portal}`,
      result.title,
      `  ${result.company ?? "-"} | ${result.location ?? "-"} | ${shortDate(result.date)} | remote: ${remoteLabel(result.remote)}`,
      `  id: ${result.id}`,
      result.salary === null ? "  salary: -" : `  salary: ${result.salary}`,
      `  ${result.url}`,
    ].join("\n")
  return rows.map(block).join("\n\n")
}

export async function runSearch(opts: SearchOpts, dependencies: SearchDependencies = {}): Promise<number> {
  const emitError = dependencies.writeError ?? writeError
  try {
    const credentials = dependencies.credentials ?? requireCredentials(dependencies.env)
    const response = await apiGet<unknown>(buildSearchUrl(opts), apiOptions(dependencies, credentials))
    const rows = jobsFromResponse(response)
      .map((offer) => toResult(offer))
      .filter((result): result is JobResult => result !== null)
      .slice(0, opts.limit)
    const payload = {
      meta: {
        portal: "infojobs",
        count: rows.length,
        query: opts.query,
        location: opts.where ?? null,
      },
      results: rows,
    }

    if (opts.format === "table") process.stdout.write(renderTable(rows) + "\n")
    else if (opts.format === "plain") process.stdout.write(renderPlain(rows) + "\n")
    else process.stdout.write(JSON.stringify(payload, null, 2) + "\n")
    return 0
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "NO_CREDENTIALS") {
      emitError(error.message, "NO_CREDENTIALS")
      return 2
    }
    emitError(error instanceof Error ? error.message : String(error), "SEARCH_FAILED")
    return 1
  }
}
