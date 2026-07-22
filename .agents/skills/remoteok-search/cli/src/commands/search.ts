import {
  API_BASE,
  apiGet,
  jobsFromResponse,
  stripHtml,
  toResult,
  writeError,
  type ApiGetOptions,
  type ErrorWriter,
  type JobResult,
  type RemoteOkJob,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  tag?: string
  limit: number
  format: "json" | "table" | "plain"
}

export interface SearchDependencies {
  writeError?: ErrorWriter
  fetchFn?: typeof fetch
  apiGet?: <T>(url: string, options?: ApiGetOptions) => Promise<T>
}

// RemoteOK does not provide a reliable server-side search contract.
export function buildUrl(_opts: SearchOpts): string {
  return API_BASE
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

function tagValues(job: RemoteOkJob): string[] {
  return Array.isArray(job.tags) ? job.tags.filter((tag): tag is string => typeof tag === "string") : []
}

function jobSearchTokens(job: RemoteOkJob): Set<string> {
  return tokenize(
    [
      job.position,
      job.company,
      tagValues(job).join(" "),
      stripHtml(job.description),
      job.location,
    ]
      .map((value) => (typeof value === "string" ? value : ""))
      .join(" "),
  )
}

function matchesQuery(job: RemoteOkJob, rawQuery?: string): boolean {
  const queryTokens = tokenize(rawQuery ?? "")
  if (queryTokens.size === 0) return true

  const jobTokens = jobSearchTokens(job)
  return [...queryTokens].every((token) => jobTokens.has(token))
}

function matchesTag(job: RemoteOkJob, rawTag?: string): boolean {
  const tag = normalizeText(rawTag ?? "")
  if (!tag) return true
  return tagValues(job).some((value) => normalizeText(value) === tag)
}

function filterJobs(jobs: RemoteOkJob[], opts: SearchOpts): RemoteOkJob[] {
  return jobs.filter((job) => matchesQuery(job, opts.query) && matchesTag(job, opts.tag))
}

function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
}

interface Column {
  header: string
  width: number
  cell: (result: JobResult) => string
}

const ATTRIBUTION = "Source: Remote OK (https://remoteok.com/remote-jobs)"

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return ["portal: remoteok", "No results.", ATTRIBUTION].join("\n")

  const columns: Column[] = [
    { header: "ID", width: Math.max(2, ...rows.map((result) => result.id.length)), cell: (result) => result.id },
    { header: "PORTAL", width: 8, cell: (result) => result.portal },
    { header: "TITLE", width: 38, cell: (result) => result.title },
    { header: "COMPANY", width: 22, cell: (result) => result.company ?? "—" },
    { header: "LOCATION", width: 26, cell: (result) => result.location },
    { header: "DATE", width: 10, cell: (result) => shortDate(result.date) },
    { header: "SALARY", width: 15, cell: (result) => result.salary ?? "—" },
  ]
  const row = (cells: string[]) =>
    cells.map((cell, index) => cell.slice(0, columns[index].width).padEnd(columns[index].width)).join("  ")
  const header = row(columns.map((column) => column.header))
  const body = rows.map((result) => row(columns.map((column) => column.cell(result))))
  return ["portal: remoteok", header, "-".repeat(header.length), ...body, ATTRIBUTION].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return ["portal: remoteok", "No results.", ATTRIBUTION].join("\n")
  const block = (result: JobResult) =>
    [
      `portal: ${result.portal}`,
      result.title,
      `  ${result.company ?? "—"} · ${result.location} · ${shortDate(result.date)}${result.salary ? ` · ${result.salary}` : ""}`,
      `  id: ${result.id}`,
      `  ${result.url}`,
    ].join("\n")
  return [rows.map(block).join("\n\n"), ATTRIBUTION].join("\n\n")
}

export async function runSearch(opts: SearchOpts, dependencies: SearchDependencies = {}): Promise<number> {
  const emitError = dependencies.writeError ?? writeError

  try {
    const request = dependencies.apiGet ?? apiGet
    const data = await request<unknown>(buildUrl(opts), { fetchFn: dependencies.fetchFn })
    const rows = filterJobs(jobsFromResponse(data), opts).slice(0, opts.limit).map(toResult)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              portal: "remoteok",
              count: rows.length,
              query: opts.query ?? null,
              location: null,
            },
            results: rows,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (error) {
    emitError(error instanceof Error ? error.message : String(error), "SEARCH_FAILED")
    return 1
  }
}
