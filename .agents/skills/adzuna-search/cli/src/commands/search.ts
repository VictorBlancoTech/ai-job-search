import {
  API_BASE,
  apiGet,
  getCredentials,
  toResult,
  writeError,
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

function buildUrl(opts: SearchOpts, creds: { appId: string; appKey: string }): string {
  const p = new URLSearchParams()
  p.set("app_id", creds.appId)
  p.set("app_key", creds.appKey)
  // results_per_page caps at 50 on the API side.
  p.set("results_per_page", String(Math.min(Math.max(1, opts.limit), 50)))
  p.set("sort_by", "date")
  p.set("content-type", "application/json")
  if (opts.query) p.set("what", opts.query)
  if (opts.where) p.set("where", opts.where)
  return `${API_BASE}/${opts.country}/search/${opts.page}?${p.toString()}`
}

/** The date portion (YYYY-MM-DD) of an ISO timestamp, or "—" when absent. */
function shortDate(date: string | null): string {
  return date ? date.slice(0, 10) : "—"
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

export async function runSearch(opts: SearchOpts): Promise<number> {
  const creds = getCredentials()
  if (!creds) {
    writeError(
      "missing Adzuna credentials: set ADZUNA_APP_ID and ADZUNA_APP_KEY (environment or repo .env)",
      "NO_CREDENTIALS",
    )
    return 2
  }

  try {
    const data = await apiGet<SearchResponse>(buildUrl(opts, creds))
    const rows = (data.results ?? []).map(toResult)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              portal: "adzuna",
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
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}
