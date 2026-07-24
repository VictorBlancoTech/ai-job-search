import {
  API_BASE,
  apiGet,
  toResult,
  writeError,
  type ApiGetOptions,
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
  format: "json" | "table" | "plain"
}

export interface SearchDependencies {
  writeError?: ErrorWriter
  apiGet?: <T>(url: string, options?: ApiGetOptions) => Promise<T>
}

const LOCALE: Record<SearchOpts["country"], string> = {
  it: "it_IT",
  es: "es_ES",
}

export function buildUrl(opts: SearchOpts): string {
  const p = new URLSearchParams()
  p.set("locale_code", LOCALE[opts.country])
  // pagesize caps at 99 on the API side.
  p.set("pagesize", String(Math.min(Math.max(1, opts.limit), 99)))
  p.set("page", String(Math.max(1, opts.page)))
  p.set("sort", "relevance")
  if (opts.query) p.set("keywords", opts.query)
  if (opts.where) p.set("location", opts.where)
  return `${API_BASE}?${p.toString()}`
}

/** The date portion (YYYY-MM-DD) of a parsed Careerjet date, or "—" when absent. */
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

export async function runSearch(opts: SearchOpts, dependencies: SearchDependencies = {}): Promise<number> {
  const emitError = dependencies.writeError ?? writeError

  try {
    const request = dependencies.apiGet ?? apiGet
    const data = await request<SearchResponse>(buildUrl(opts))
    const rows = (data.jobs ?? []).map(toResult)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              portal: "careerjet",
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
