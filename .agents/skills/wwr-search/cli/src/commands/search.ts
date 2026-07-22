import {
  DEFAULT_CATEGORIES,
  HIMALAYAS_API_BASE,
  WWR_RSS_BASE,
  apiGet,
  apiGetText,
  jobsFromHimalayasResponse,
  jobsFromRss,
  InvalidArgumentError,
  stripHtml,
  toHimalayasResult,
  toWwrResult,
  VERIFIED_WWR_CATEGORIES,
  writeError,
  type ErrorWriter,
  type HimalayasResponse,
  type JobResult,
  type Portal,
  type RequestOptions,
} from "../helpers.js"

export type Source = "wwr" | "himalayas" | "both"

export interface SearchOpts {
  query?: string
  source: Source
  categories: string[]
  limit: number
  format: "json" | "table" | "plain"
}

export interface SearchDependencies {
  writeError?: ErrorWriter
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
}

export function buildWwrUrl(category: string): string {
  return `${WWR_RSS_BASE}/${category}.rss`
}

export function buildHimalayasUrl(limit = 20, offset = 0): string {
  const url = new URL(HIMALAYAS_API_BASE)
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("offset", String(offset))
  return url.toString()
}

export function parseCategories(values: string[]): string[] {
  const categories = values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
  if (categories.length === 0) throw new InvalidArgumentError("at least one WWR category is required")

  const invalid = categories.find(
    (category) =>
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(category) ||
      !(VERIFIED_WWR_CATEGORIES as readonly string[]).includes(category),
  )
  if (invalid !== undefined) {
    throw new InvalidArgumentError(
      `--category must be one of ${VERIFIED_WWR_CATEGORIES.join(", ")}, got "${invalid}"`,
    )
  }
  return [...new Set(categories)]
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") return ""
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(value: unknown): Set<string> {
  return new Set(normalizeText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean))
}

function matchesQuery(result: JobResult, rawQuery?: string): boolean {
  const queryTokens = tokenize(rawQuery ?? "")
  if (queryTokens.size === 0) return true
  const resultTokens = tokenize(
    [result.title, result.company, stripHtml(result.description), result.location]
      .map((value) => value ?? "")
      .join(" "),
  )
  return [...queryTokens].every((token) => resultTokens.has(token))
}

function filterResults(results: JobResult[], query?: string): JobResult[] {
  return results.filter((result) => matchesQuery(result, query))
}

function requestOptions(dependencies: SearchDependencies): RequestOptions {
  return { fetchFn: dependencies.fetchFn, sleepFn: dependencies.sleepFn }
}

async function fetchWwr(categories: string[], dependencies: SearchDependencies): Promise<JobResult[]> {
  const results: JobResult[] = []
  for (const category of categories) {
    const xml = await apiGetText(buildWwrUrl(category), requestOptions(dependencies))
    for (const job of jobsFromRss(xml)) {
      const result = toWwrResult(job)
      if (result !== null) results.push(result)
    }
  }
  return results
}

async function fetchHimalayas(limit: number, dependencies: SearchDependencies): Promise<JobResult[]> {
  const results: JobResult[] = []
  const pageSize = 20
  const target = Math.min(100, Math.max(pageSize, limit))
  let offset = 0
  let fetched = 0

  while (fetched < target) {
    const data = await apiGet<unknown>(buildHimalayasUrl(pageSize, offset), requestOptions(dependencies))
    const jobs = jobsFromHimalayasResponse(data)
    fetched += jobs.length
    for (const job of jobs) {
      const result = toHimalayasResult(job)
      if (result !== null) results.push(result)
    }

    const envelope = data as HimalayasResponse
    const totalCount = typeof envelope.totalCount === "number" && Number.isSafeInteger(envelope.totalCount)
      ? envelope.totalCount
      : null
    if (jobs.length < pageSize || jobs.length === 0 || fetched >= target || (totalCount !== null && offset + jobs.length >= totalCount)) break
    offset += pageSize
  }
  return results
}

function mergeResults(groups: JobResult[][]): JobResult[] {
  const seen = new Set<string>()
  const merged: JobResult[] = []
  for (const group of groups) {
    for (const result of group) {
      const key = `${result.portal}\u0000${result.id}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(result)
    }
  }
  return merged
}

function shortDate(date: string | null): string {
  return date ?? "-"
}

interface Column {
  header: string
  width: number
  cell: (result: JobResult) => string
}

interface SourceFailure {
  source: Portal
  error: Error
}

const SOURCE_LABELS: Record<Portal, string> = {
  wwr: "We Work Remotely RSS",
  himalayas: "Himalayas public API",
}

function sourceStatus(sources: Portal[], failures: SourceFailure[]): string[] {
  const lines = [`Sources: ${sources.map((source) => SOURCE_LABELS[source]).join(" and ")}`]
  for (const failure of failures) {
    if (!sources.includes(failure.source)) {
      lines.push(`Unavailable: ${SOURCE_LABELS[failure.source]} (${failure.error.message})`)
    }
  }
  return lines
}

function renderTable(rows: JobResult[], sources: Portal[], failures: SourceFailure[]): string {
  if (rows.length === 0) return ["portal: wwr-search", "No results.", ...sourceStatus(sources, failures)].join("\n")
  const columns: Column[] = [
    { header: "PORTAL", width: 10, cell: (result) => result.portal },
    { header: "TITLE", width: 38, cell: (result) => result.title },
    { header: "COMPANY", width: 22, cell: (result) => result.company ?? "-" },
    { header: "LOCATION", width: 28, cell: (result) => result.location ?? "-" },
    { header: "DATE", width: 10, cell: (result) => shortDate(result.date) },
    { header: "SALARY", width: 24, cell: (result) => result.salary ?? "-" },
  ]
  const row = (cells: string[]) =>
    cells.map((cell, index) => cell.slice(0, columns[index].width).padEnd(columns[index].width)).join("  ")
  const header = row(columns.map((column) => column.header))
  const body = rows.map((result) => row(columns.map((column) => column.cell(result))))
  return ["portal: wwr-search", header, "-".repeat(header.length), ...body, ...sourceStatus(sources, failures)].join("\n")
}

function renderPlain(rows: JobResult[], sources: Portal[], failures: SourceFailure[]): string {
  if (rows.length === 0) return ["portal: wwr-search", "No results.", ...sourceStatus(sources, failures)].join("\n")
  const block = (result: JobResult) =>
    [
      `portal: ${result.portal}`,
      result.title,
      `  ${result.company ?? "-"} | ${result.location ?? "-"} | ${shortDate(result.date)}${result.salary ? ` | ${result.salary}` : ""}`,
      `  id: ${result.id}`,
      `  ${result.url}`,
    ].join("\n")
  return [rows.map(block).join("\n\n"), sourceStatus(sources, failures).join("\n")].join("\n\n")
}

function sourceUnavailable(source: Portal, error: unknown): Error {
  const label = source === "wwr" ? "WWR" : "Himalayas"
  return new Error(`${label} source unavailable: ${error instanceof Error ? error.message : String(error)}`)
}

export async function runSearch(opts: SearchOpts, dependencies: SearchDependencies = {}): Promise<number> {
  const emitError = dependencies.writeError ?? writeError
  const groups: JobResult[][] = []
  const successfulSources: Portal[] = []
  const failures: SourceFailure[] = []

  if (opts.source === "wwr" || opts.source === "both") {
    try {
      groups.push(await fetchWwr(opts.categories, dependencies))
      successfulSources.push("wwr")
    } catch (error) {
      failures.push({ source: "wwr", error: sourceUnavailable("wwr", error) })
      if (opts.source === "wwr") {
        emitError(failures[0]!.error.message, "SOURCE_UNAVAILABLE")
        return 1
      }
    }
  }

  if (opts.source === "himalayas" || opts.source === "both") {
    try {
      groups.push(await fetchHimalayas(opts.limit, dependencies))
      successfulSources.push("himalayas")
    } catch (error) {
      failures.push({ source: "himalayas", error: sourceUnavailable("himalayas", error) })
      if (opts.source === "himalayas") {
        emitError(failures.at(-1)!.error.message, "SOURCE_UNAVAILABLE")
        return 1
      }
    }
  }

  if (successfulSources.length === 0) {
    emitError(
      failures.map((failure) => failure.error.message).join("; ") || "no source was available",
      "SOURCE_UNAVAILABLE",
    )
    return 1
  }

  const rows = filterResults(mergeResults(groups), opts.query).slice(0, opts.limit)
  const payload = {
    meta: {
      portal: "wwr-search",
      count: rows.length,
      query: opts.query ?? null,
      location: null,
      sources: successfulSources,
    },
    results: rows,
  }

  if (opts.format === "table") process.stdout.write(renderTable(rows, successfulSources, failures) + "\n")
  else if (opts.format === "plain") process.stdout.write(renderPlain(rows, successfulSources, failures) + "\n")
  else process.stdout.write(JSON.stringify(payload, null, 2) + "\n")
  return 0
}

export { DEFAULT_CATEGORIES }
