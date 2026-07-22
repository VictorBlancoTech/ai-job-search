import { URLSearchParams } from "node:url"
import {
  API_BASE,
  apiGet,
  jobsFromResponse,
  stripHtml,
  toResult,
  writeError,
  type ApiGetOptions,
  type ArbeitnowJob,
  type ErrorWriter,
  type JobResult,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  remoteOnly: boolean
  page: number
  limit: number
  format: "json" | "table" | "plain"
}

export interface SearchDependencies {
  writeError?: ErrorWriter
  fetchFn?: typeof fetch
  apiGet?: <T>(url: string, options?: ApiGetOptions) => Promise<T>
}

export function buildUrl(opts: SearchOpts): string {
  const params = new URLSearchParams()
  if (opts.query?.trim()) params.set("search", opts.query)
  params.set("page", String(opts.page))
  return `${API_BASE}?${params.toString()}`
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

function tagValues(job: ArbeitnowJob): string[] {
  return Array.isArray(job.tags) ? job.tags.filter((tag): tag is string => typeof tag === "string") : []
}

function jobSearchTokens(job: ArbeitnowJob): Set<string> {
  return tokenize(
    [
      job.title,
      job.company_name,
      tagValues(job).join(" "),
      stripHtml(job.description),
      job.location,
    ]
      .map((value) => (typeof value === "string" ? value : ""))
      .join(" "),
  )
}

function matchesQuery(job: ArbeitnowJob, rawQuery?: string): boolean {
  const queryTokens = tokenize(rawQuery ?? "")
  if (queryTokens.size === 0) return true

  const jobTokens = jobSearchTokens(job)
  return [...queryTokens].every((token) => jobTokens.has(token))
}

function matchesRemote(job: ArbeitnowJob, remoteOnly: boolean): boolean {
  return !remoteOnly || job.remote === true
}

function filterJobs(jobs: ArbeitnowJob[], opts: SearchOpts): ArbeitnowJob[] {
  return jobs.filter((job) => matchesQuery(job, opts.query) && matchesRemote(job, opts.remoteOnly))
}

function shortDate(date: string | null): string {
  return date ?? "-"
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
    { header: "COMPANY", width: 22, cell: (result) => result.company ?? "-" },
    { header: "LOCATION", width: 26, cell: (result) => result.location ?? "-" },
    { header: "DATE", width: 10, cell: (result) => shortDate(result.date) },
    { header: "REMOTE", width: 6, cell: (result) => (result.remote === true ? "yes" : "no") },
    { header: "SALARY", width: 15, cell: (result) => result.salary ?? "-" },
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
      `  ${result.company ?? "-"} | ${result.location ?? "-"} | ${shortDate(result.date)}${result.salary ? ` | ${result.salary}` : ""}`,
      `  id: ${result.id}`,
      `  ${result.url}`,
    ].join("\n")
  return rows.map(block).join("\n\n")
}

export async function runSearch(opts: SearchOpts, dependencies: SearchDependencies = {}): Promise<number> {
  const emitError = dependencies.writeError ?? writeError

  try {
    const request = dependencies.apiGet ?? apiGet
    const data = await request<unknown>(buildUrl(opts), { fetchFn: dependencies.fetchFn })
    const rows = filterJobs(jobsFromResponse(data), opts)
      .map(toResult)
      .filter((result): result is JobResult => result !== null)
      .slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(rows) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(renderPlain(rows) + "\n")
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              portal: "arbeitnow",
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
