// Data source: the Careerjet public API (https://www.careerjet.com/partners/api/)
// — a job aggregator covering 90+ countries with no authentication required.
// A polite User-Agent header is the only identification sent. The search
// endpoint returns full descriptions inline, so there is no detail command:
// search alone satisfies the portal-skill contract.

import { createHash } from "node:crypto"

export const API_BASE = "https://public.api.careerjet.net/search"

const UA = "ai-job-search-careerjet-skill/1.0 (contact: tech@victorblanco.net)"

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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * GET JSON from the Careerjet API. One retry on 429/5xx (transient states)
 * after a 2s backoff; a connection failure fails fast with a clear message,
 * so an outage degrades this source quickly rather than hanging the caller.
 */
export interface ApiGetOptions {
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
      response = await fetchFn(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      })
    } catch (e) {
      throw new Error(
        `could not reach the Careerjet API (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Careerjet API request failed: ${response.status} ${response.statusText}`)
      }
      await sleepFn(retryDelayMs)
      continue
    }

    const body = (await response.json().catch(() => null)) as T | null
    if (!response.ok) {
      throw new Error(`Careerjet API request failed: ${response.status} ${response.statusText}`)
    }
    if (!body) throw new Error("Careerjet API returned an unparseable response body")
    return body
  }
  // Unreachable in practice; the loop returns or throws on the last attempt.
  throw new Error("Careerjet API request failed after retries")
}

/**
 * A Careerjet job — the fields this skill reads. The wire shape is flat
 * (no nested company/location objects) and the date is localized prose
 * ("mercoledì, 23 luglio 2026" for it_IT).
 */
export interface CareerjetJob {
  url?: string
  title?: string
  company?: string
  locations?: string
  description?: string
  date?: string
  salary?: string
  salary_min?: number
  salary_max?: number
  salary_currency_code?: string
  salary_type?: string
  site?: string
}

/** The search endpoint's response envelope. */
export interface SearchResponse {
  type?: string
  hits?: number
  pages?: number
  jobs?: CareerjetJob[]
}

/** A search result in the unified portal-skill contract shape. */
export interface JobResult {
  id: string
  portal: "careerjet"
  title: string
  company: string | null
  location: string | null
  url: string
  date: string | null
  description: string
  remote: boolean | null
  salary: string | null
}

/** Careerjet exposes no stable job id — use sha1 of the URL. */
export function stableId(url: string): string {
  return createHash("sha1").update(url, "utf8").digest("hex")
}

// Localized month-name → number map. Italian and Spanish are required by the
// contract; English is included defensively because the upstream docs use
// English examples. Names are matched lowercase against the input.
const MONTHS: Record<string, number> = {
  // Italian
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6,
  luglio: 7, agosto: 8, settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
  // Spanish (marzo / agosto / etc. collide with Italian — same value, fine)
  enero: 1, febrero: 2, abril: 4, mayo: 5, junio: 6,
  julio: 7, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  // English (defensive)
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

/**
 * Parse a Careerjet localized date ("mercoledì, 23 luglio 2026",
 * "miércoles, 23 julio 2026", "Wednesday, 23 July 2026") to YYYY-MM-DD.
 * Returns null when the input is missing or the month name is unknown.
 * The leading weekday (if any) is ignored.
 */
export function parseCareerjetDate(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.match(/(\d{1,2})\s+([A-Za-zàèéìòùÀÈÉÌÒÙñÑüÜ]+)\s+(\d{4})/)
  if (!m) return null
  const day = Number(m[1])
  const month = MONTHS[m[2].toLowerCase()]
  const year = Number(m[3])
  if (!month) return null
  if (day < 1 || day > 31) return null
  if (year < 1970 || year > 2100) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** "min-max CUR" when both bounds exist; null otherwise (per the contract). */
function formatSalary(min?: number, max?: number, currency?: string): string | null {
  if (min == null || max == null) return null
  return `${min}-${max} ${currency ?? "EUR"}`
}

/** Reshape a Careerjet job into the contract search-result fields. */
export function toResult(j: CareerjetJob): JobResult {
  const url = j.url || ""
  return {
    id: stableId(url),
    portal: "careerjet",
    title: j.title || "(untitled)",
    company: j.company || null,
    location: j.locations || null,
    url,
    date: parseCareerjetDate(j.date),
    description: stripHtml(j.description),
    // Careerjet's search API exposes no remote-work field — never guess.
    remote: null,
    salary: formatSalary(j.salary_min, j.salary_max, j.salary_currency_code),
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
const OPTION_NAMES = new Set(["query", "where", "country", "page", "limit", "format", "help", "h"])
const BOOLEAN_OPTIONS = new Set(["help", "h"])
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
