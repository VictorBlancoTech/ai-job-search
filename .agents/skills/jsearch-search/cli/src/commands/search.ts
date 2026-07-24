import {
  API_BASE,
  apiGet,
  getApiKey,
  toResult,
  writeError,
  type ApiGetOptions,
  type Environment,
  type ErrorWriter,
  type JobResult,
  type SearchResponse,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  where?: string
  country: "it" | "es"
  page: number
  limit: number
  remote: boolean
  format: "json" | "table" | "plain"
}

export interface SearchDependencies {
  repoRoot?: string
  environment?: Environment
  writeError?: ErrorWriter
  writeWarning?: (message: string) => void
  apiGet?: <T>(url: string, options?: ApiGetOptions) => Promise<T>
}

function defaultWarning(message: string): void {
  process.stderr.write(`warning: ${message}\n`)
}

/**
 * JSearch prefers a single free-text query with the location inlined
 * ("IT Manager in Bologna") — the API is backed by a Google-style search,
 * so `where` is folded into the query string rather than sent separately.
 */
export function composeQuery(opts: SearchOpts): string {
  const parts: string[] = []
  if (opts.query) parts.push(opts.query)
  if (opts.where) parts.push(`in ${opts.where}`)
  return parts.join(" ")
}

export function buildUrl(opts: SearchOpts): string {
  const p = new URLSearchParams()
  p.set("query", composeQuery(opts))
  p.set("country", opts.country)
  p.set("page", String(Math.max(1, opts.page)))
  // The API returns ~10 jobs per page; --limit up to 20 fetches a second
  // page and the caller slices below.
  p.set("num_pages", String(Math.min(2, Math.max(1, Math.ceil(opts.limit / 10)))))
  if (opts.remote) p.set("remote_jobs_only", "true")
  return `${API_BASE}?${p.toString()}`
}

/** The date portion (YYYY-MM-DD) of a parsed JSearch date, or "—" when absent. */
function shortDate(date: string | null): string {
  return date ?? "—"
}

// Table columns: header, width, and the cell value. The ID column is sized to
// the longest id so it is never truncated; the fixed-width columns truncate
// for scanning.
interface Column {
  header: string
  width: number
  cell: (r: JobResult) => string
}

function renderTable(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const columns: Column[] = [
    { header: "ID", width: Math.max(2, ...rows.map((r) => r.id.length)), cell: (r) => r.id },
    { header: "TITLE", width: 38, cell: (r) => r.title },
    { header: "COMPANY", width: 22, cell: (r) => r.company ?? "—" },
    { header: "LOCATION", width: 26, cell: (r) => r.location ?? "—" },
    { header: "DATE", width: 10, cell: (r) => shortDate(r.date) },
    { header: "SALARY", width: 15, cell: (r) => r.salary ?? "—" },
  ]
  const row = (cells: string[]) => cells.map((c, i) => c.slice(0, columns[i].width).padEnd(columns[i].width)).join("  ")

  const header = row(columns.map((c) => c.header))
  const body = rows.map((r) => row(columns.map((c) => c.cell(r))))
  return [header, "-".repeat(header.length), ...body].join("\n")
}

function renderPlain(rows: JobResult[]): string {
  if (rows.length === 0) return "No results."
  const block = (r: JobResult) =>
    [
      r.title,
      `  ${r.company ?? "—"} · ${r.location ?? "—"} · ${shortDate(r.date)}${r.salary ? ` · ${r.salary}` : ""}`,
      `  id: ${r.id}`,
      `  ${r.url}`,
    ].join("\n")
  return rows.map(block).join("\n\n")
}

/** Warn when the freemium monthly quota drops below 20 remaining requests. */
export function checkQuotaHeaders(headers: Headers, warn: (message: string) => void): void {
  const remaining = headers.get("X-RateLimit-Remaining")
  if (remaining === null) return
  const n = Number(remaining)
  if (Number.isFinite(n) && n < 20) {
    warn(`jsearch quota low — ${n} requests remaining this month`)
  }
}

export async function runSearch(opts: SearchOpts, dependencies: SearchDependencies = {}): Promise<number> {
  const emitError = dependencies.writeError ?? writeError
  const emitWarning = dependencies.writeWarning ?? defaultWarning
  const apiKey = getApiKey(dependencies.repoRoot, dependencies.environment)
  if (!apiKey) {
    emitError(
      "missing JSearch API key: set JSEARCH_API_KEY (environment or repo .env)",
      "NO_CREDENTIALS",
    )
    return 2
  }

  try {
    const request = dependencies.apiGet ?? apiGet
    const data = await request<SearchResponse>(buildUrl(opts), {
      apiKey,
      onHeaders: (headers) => checkQuotaHeaders(headers, emitWarning),
    })
    const rows = (data.data ?? []).slice(0, opts.limit).map(toResult)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              portal: "jsearch",
              count: rows.length,
              query: opts.query ?? null,
              location: opts.where ?? null,
            },
            results: rows,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    emitError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
