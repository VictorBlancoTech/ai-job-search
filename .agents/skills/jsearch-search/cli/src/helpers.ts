// Data source: the JSearch API (OpenWebNinja) — https://www.openwebninja.com/jsearch
// — a freemium aggregator (~200 requests/month free tier) that merges LinkedIn,
// Indeed, Glassdoor and others into one schema. Authenticated with an
// X-API-Key header, read from the environment or the repo's .env file.
// The search endpoint returns full descriptions inline, so there is no detail
// command: search alone satisfies the portal-skill contract.

import { readFileSync } from "node:fs"
import { join } from "node:path"

export const API_BASE = "https://api.openwebninja.com/jsearch/search"

const UA = "ai-job-search-jsearch-skill/1.0 (contact: tech@victorblanco.net)"

export type ErrorWriter = (error: string, code: string) => void

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

export class InvalidArgumentError extends Error {
  readonly code = "INVALID_ARGUMENT"

  constructor(message: string) {
    super(message)
    this.name = "InvalidArgumentError"
  }
}

/**
 * Parse a .env file into a key/value map. Ignores comments (#) and blank
 * lines, trims whitespace, and keeps "=" characters inside values. A missing
 * or unreadable file yields an empty map (the caller decides if that is fatal).
 */
export function loadEnvFile(path: string): Record<string, string> {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    return {}
  }
  const env: Record<string, string> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eq = trimmed.indexOf("=")
    if (eq <= 0) continue
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return env
}

/** Load the .env file at a repository root. */
export function loadEnv(repoRoot: string): Record<string, string> {
  return loadEnvFile(join(repoRoot, ".env"))
}

/**
 * JSearch API key: process.env wins, then the repo-root .env (five levels
 * up from cli/src). Returns null when missing — the CLI maps that to exit
 * code 2 with a clear message.
 */
export type Environment = Record<string, string | undefined>

export function getApiKey(
  repoRoot = join(import.meta.dir, "..", "..", "..", "..", ".."),
  environment: Environment = process.env,
): string | null {
  const fileEnv = loadEnv(repoRoot)
  return environment.JSEARCH_API_KEY || fileEnv.JSEARCH_API_KEY || null
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * GET JSON from the JSearch API. One retry on 429/5xx (transient states)
 * after a 2s backoff; a connection failure fails fast with a clear message,
 * so an outage degrades this source quickly rather than hanging the caller.
 * `onHeaders` fires on every response so callers can watch quota headers
 * (X-RateLimit-Remaining) without coupling transport to policy.
 */
export interface ApiGetOptions {
  apiKey?: string
  onHeaders?: (headers: Headers) => void
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
  retryDelayMs?: number
  timeoutMs?: number
}

export async function apiGet<T>(url: string, options: ApiGetOptions = {}): Promise<T> {
  const maxRetries = 1
  const fetchFn = options.fetchFn ?? globalThis.fetch
  const sleepFn = options.sleepFn ?? sleep
  const retryDelayMs = options.retryDelayMs ?? 2000
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      const headers: Record<string, string> = { Accept: "application/json", "User-Agent": UA }
      if (options.apiKey) headers["X-API-Key"] = options.apiKey
      response = await fetchFn(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      })
    } catch (e) {
      throw new Error(
        `could not reach the JSearch API (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    options.onHeaders?.(response.headers)

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`JSearch API request failed: ${response.status} ${response.statusText}`)
      }
      await sleepFn(retryDelayMs)
      continue
    }

    const body = (await response.json().catch(() => null)) as T | null
    if (!response.ok) {
      throw new Error(`JSearch API request failed: ${response.status} ${response.statusText}`)
    }
    if (!body) throw new Error("JSearch API returned an unparseable response body")
    return body
  }
  // Unreachable in practice; the loop returns or throws on the last attempt.
  throw new Error("JSearch API request failed after retries")
}

/**
 * A JSearch job — the fields this skill reads. The wire shape is flat with
 * `job_`/`employer_` prefixes; dates arrive as ISO-8601 UTC strings and the
 * id is the API's own stable `job_id`.
 */
export interface JSearchJob {
  job_id?: string
  job_title?: string
  employer_name?: string
  job_publisher?: string
  job_employment_type?: string
  job_apply_link?: string
  job_apply_is_direct?: boolean
  job_description?: string
  job_is_remote?: boolean
  job_posted_at_timestamp?: number
  job_posted_at_datetime_utc?: string
  job_city?: string
  job_state?: string
  job_country?: string
  job_min_salary?: number
  job_max_salary?: number
  job_salary_currency?: string
  job_salary_period?: string
}

/** The search endpoint's response envelope. */
export interface SearchResponse {
  status?: string
  request_id?: string
  parameters?: Record<string, unknown>
  data?: JSearchJob[]
}

/** A search result in the unified portal-skill contract shape. */
export interface JobResult {
  id: string
  portal: "jsearch"
  title: string
  company: string | null
  location: string | null
  url: string
  date: string | null
  description: string
  remote: boolean | null
  salary: string | null
}

/**
 * "city, state, country" skipping empty parts; null when all three are
 * missing. The wire fields are already short labels ("Bologna",
 * "Emilia-Romagna", "IT"), so a plain join matches the other portals' style.
 */
export function buildLocation(
  city?: string,
  state?: string,
  country?: string,
): string | null {
  const parts = [city, state, country].filter((p): p is string => Boolean(p && p.trim()))
  return parts.length ? parts.join(", ") : null
}

/**
 * ISO-8601 UTC timestamp ("2026-07-23T12:00:00.000Z") → "2026-07-23".
 * Returns null when the input is missing, not ISO-shaped, or carries an
 * impossible month/day — never guesses.
 */
export function parseJsearchDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}/)
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** "min-max CUR" when both bounds exist; null otherwise (per the contract). */
function formatSalary(min?: number, max?: number, currency?: string): string | null {
  if (min == null || max == null) return null
  return `${min}-${max} ${currency ?? "EUR"}`
}

/** Reshape a JSearch job into the contract search-result fields. */
export function toResult(j: JSearchJob): JobResult {
  return {
    id: j.job_id || "",
    portal: "jsearch",
    title: j.job_title || "(untitled)",
    company: j.employer_name || null,
    location: buildLocation(j.job_city, j.job_state, j.job_country),
    url: j.job_apply_link || "",
    date: parseJsearchDate(j.job_posted_at_datetime_utc),
    description: stripHtml(j.job_description),
    // job_is_remote is a direct boolean on the wire; null only when absent.
    remote: j.job_is_remote ?? null,
    salary: formatSalary(j.job_min_salary, j.job_max_salary, j.job_salary_currency),
  }
}

// Named entities beyond the XML basics: Latin-1 letters common in Italian and
// Spanish postings, plus a few typographic marks.
const NAMED_ENTITIES: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  euro: "€", ndash: "–", mdash: "—",
  copy: "©", bull: "•", trade: "™", middot: "·",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  cent: "¢", pound: "£", yen: "¥", sect: "§", para: "¶",
  plusmn: "±", times: "×", divide: "÷",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", ccedil: "ç", uuml: "ü", Uuml: "Ü",
  hellip: "…", laquo: "«", raquo: "»", deg: "°",
})

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
}

function findTagEnd(input: string, start: number): number {
  let quote: '"' | "'" | null = null
  for (let i = start; i < input.length; i++) {
    const char = input[i]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === ">") {
      return i
    }
  }
  return -1
}

function stripTagsPreservingBreaks(html: string): string {
  let text = ""
  let cursor = 0

  while (cursor < html.length) {
    const start = html.indexOf("<", cursor)
    if (start === -1) {
      text += html.slice(cursor)
      break
    }

    text += html.slice(cursor, start)

    if (html.startsWith("<!--", start)) {
      const commentEnd = html.indexOf("-->", start + 4)
      if (commentEnd === -1) break
      cursor = commentEnd + 3
      continue
    }

    const end = findTagEnd(html, start + 1)
    if (end === -1) {
      text += html.slice(start)
      break
    }

    const content = html.slice(start + 1, end)
    const match = content.match(/^\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)\b/)
    if (!match) {
      // Leave non-tag angle-bracket text alone instead of deleting it.
      text += html.slice(start, end + 1)
      cursor = end + 1
      continue
    }

    const closing = match[1] === "/"
    const name = match[2].toLowerCase()
    if (!closing && name === "br") {
      text += "\n"
    } else if (closing && (name === "p" || name === "li" || name === "ul" || name === "ol" || name === "div" || /^h[1-6]$/.test(name))) {
      text += "\n"
    } else {
      text += " "
    }
    cursor = end + 1
  }

  return text
}

/**
 * Strip HTML into readable prose: block/line-break tags become newlines,
 * entities are decoded, tags removed. Always returns a string ("" for empty
 * input) because the contract's description field is non-nullable.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return ""
  return decodeHtmlEntities(stripTagsPreservingBreaks(html))
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

// Short-flag aliases.
const ALIAS: Record<string, string> = { q: "query", l: "where", n: "limit" }
const OPTION_NAMES = new Set(["query", "where", "country", "page", "limit", "remote", "format", "help", "h"])
const BOOLEAN_OPTIONS = new Set(["remote", "help", "h"])
const NUMERIC_OPTIONS = new Set(["page", "limit"])

/** Parse the CLI flags and reject unknown options or missing values. */
export function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      ;(flags._ as string[]).push(a)
      continue
    }
    const name = a.replace(/^-+/, "")
    if (!name) throw new InvalidArgumentError(`invalid option "${a}"`)
    const key = ALIAS[name] ?? name
    if (!OPTION_NAMES.has(key)) throw new InvalidArgumentError(`unknown option "${a}"`)

    if (BOOLEAN_OPTIONS.has(key)) {
      flags[key] = true
      continue
    }

    const next = argv[i + 1]
    const negativeNumericValue = NUMERIC_OPTIONS.has(key) && next !== undefined && /^-\d+$/.test(next)
    if (next === undefined || (next.startsWith("-") && !negativeNumericValue)) {
      throw new InvalidArgumentError(`${a} requires a value`)
    }
    flags[key] = next
    i++
  }
  return flags
}
