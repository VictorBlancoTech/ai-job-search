import {
  API_BASE,
  apiGet,
  encodeQuery,
  stripHtml,
  toResult,
  writeError,
  type ApiGetOptions,
  type ErrorWriter,
  type JobResult,
  type RemotiveJob,
  type SearchResponse,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  category?: string
  limit: number
  format: "json" | "table" | "plain"
}

export interface SearchDependencies {
  writeError?: ErrorWriter
  fetchFn?: typeof fetch
  apiGet?: <T>(url: string, options?: ApiGetOptions) => Promise<T>
}

export function buildUrl(opts: SearchOpts): string {
  const query = encodeQuery({
    search: opts.query,
    category: opts.category,
    limit: String(Math.min(Math.max(1, opts.limit), 100)),
  })
  return `${API_BASE}?${query}`
}

function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(value: string): Set<string> {
  return new Set(normalizeText(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean))
}

function jobSearchTokens(job: RemotiveJob): Set<string> {
  return tokenize(
    [
      job.title,
      job.company_name ?? "",
      stripHtml(job.description ?? ""),
      job.category ?? "",
      job.candidate_required_location ?? "",
    ].join(" "),
  )
}

function matchesQuery(job: RemotiveJob, rawQuery?: string): boolean {
  const queryTokens = tokenize(rawQuery ?? "")
  if (queryTokens.size === 0) return true

  const jobTokens = jobSearchTokens(job)
  return [...queryTokens].every((token) => jobTokens.has(token))
}

function matchesCategory(job: RemotiveJob, rawCategory?: string): boolean {
  const category = normalizeText(rawCategory ?? "")
  if (!category) return true
  return normalizeText(job.category ?? "") === category
}

function filterJobs(jobs: RemotiveJob[], opts: SearchOpts): RemotiveJob[] {
  return jobs.filter((job) => matchesQuery(job, opts.query) && matchesCategory(job, opts.category))
}

function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
}

interface Column {
  header: string
  width: number
  cell: (result: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "ID", width: Math.max(2, ...rows.map((result) => result.id.length)), cell: (result) => result.id },
    { header: "TITLE", width: 38, cell: (result) => result.title },
    { header: "COMPANY", width: 22, cell: (result) => result.company ?? "—" },
    { header: "LOCATION", width: 26, cell: (result) => result.location ?? "—" },
    { header: "DATE", width: 10, cell: (result) => shortDate(result.date) },
    { header: "SALARY", width: 15, cell: (result) => result.salary ?? "—" },
  ]
  const row = (cells: string[]) =>
    cells.map((cell, index) => cell.slice(0, columns[index].width).padEnd(columns[index].width)).join("  ")
  const header = row(columns.map((column) => column.header))
  const body = rows.map((result) => row(columns.map((column) => column.cell(result))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const block = (result: JobResult) =>
    [
      result.title,
      `  ${result.company ?? "—"} · ${result.location ?? "—"} · ${shortDate(result.date)}${result.salary ? ` · ${result.salary}` : ""}`,
      `  id: ${result.id}`,
      `  ${result.url}`,
    ].join("\n")
  return rows.map(block).join("\n\n")
}

export async function runSearch(opts: SearchOpts, dependencies: SearchDependencies = {}): Promise<number> {
  const emitError = dependencies.writeError ?? writeError

  try {
    const url = buildUrl(opts)
    const data = dependencies.apiGet
      ? await dependencies.apiGet<SearchResponse>(url)
      : await apiGet<SearchResponse>(url, { fetchFn: dependencies.fetchFn })
    const filteredJobs = filterJobs(data.jobs ?? [], opts)
    // The public endpoint currently ignores filters and `limit` on some
    // responses, so apply them locally as well as passing them through.
    const rows = filteredJobs.slice(0, opts.limit).map(toResult)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              portal: "remotive",
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
