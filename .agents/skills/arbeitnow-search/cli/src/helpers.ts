export const API_BASE = "https://www.arbeitnow.com/api/job-board-api"

const USER_AGENT = "arbeitnow-search-skill/1.0 (+https://www.arbeitnow.com)"

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
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface ApiGetOptions {
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
  retryDelayMs?: number
  timeoutMs?: number
}

/** Fetch public JSON, retrying one rate-limit or server failure. */
export async function apiGet<T>(url: string, options: ApiGetOptions = {}): Promise<T> {
  const fetchFn = options.fetchFn ?? globalThis.fetch
  const sleepFn = options.sleepFn ?? sleep
  const retryDelayMs = options.retryDelayMs ?? 2000

  for (let attempt = 0; attempt <= 1; attempt++) {
    let response: Response
    try {
      response = await fetchFn(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      })
    } catch (error) {
      throw new Error(
        `could not reach the Arbeitnow API (${error instanceof Error ? error.message : String(error)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === 1) {
        throw new Error(`Arbeitnow API request failed: ${response.status} ${response.statusText}`)
      }
      await sleepFn(retryDelayMs)
      continue
    }

    const body = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(`Arbeitnow API request failed: ${response.status} ${response.statusText}`)
    }
    if (body === null) throw new Error("Arbeitnow API returned an unparseable response body")
    return body as T
  }

  throw new Error("Arbeitnow API request failed after retries")
}

export interface ArbeitnowJob {
  slug?: unknown
  id?: unknown
  company_name?: unknown
  title?: unknown
  description?: unknown
  remote?: unknown
  url?: unknown
  tags?: unknown
  job_types?: unknown
  location?: unknown
  created_at?: unknown
}

export interface SearchResponse {
  data?: unknown
  links?: unknown
  meta?: unknown
}

export interface JobResult {
  id: string
  portal: "arbeitnow"
  title: string
  company: string | null
  location: string | null
  url: string
  date: string | null
  description: string
  remote: boolean | null
  salary: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

/** Validate the envelope but keep malformed rows for safe per-row mapping. */
export function jobsFromResponse(value: unknown): ArbeitnowJob[] {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    throw new Error("Arbeitnow API returned an invalid response body")
  }
  return value.data.filter(isRecord) as ArbeitnowJob[]
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  return value
}

function stableNumberId(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return String(value)
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const calendarDate = new Date(0)
  calendarDate.setUTCFullYear(year, month - 1, day)
  calendarDate.setUTCHours(0, 0, 0, 0)
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  )
}

function formatDate(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null
  const year = date.getUTCFullYear()
  if (year < 0 || year > 9999) return null
  return date.toISOString().slice(0, 10)
}

function normalizeIsoDate(value: string): string | null {
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/,
  )
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  if (!validCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return null
  }

  const offset = match[7]
  if (offset && offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3))
    const offsetMinute = Number(offset.slice(4, 6))
    if (offsetHour > 23 || offsetMinute > 59) return null
  }

  return `${match[1]}-${match[2]}-${match[3]}`
}

/** Normalize epoch seconds or strict ISO input without Date rollover. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null
    return formatDate(new Date(value * 1000))
  }
  if (value instanceof Date) return formatDate(value)
  if (typeof value !== "string") return null
  return normalizeIsoDate(value)
}

const NAMED_ENTITIES: Record<string, string> = Object.assign(
  Object.create(null) as Record<string, string>,
  {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    euro: "€",
    ndash: "–",
    mdash: "—",
    copy: "©",
    bull: "•",
    trade: "™",
    middot: "·",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
    cent: "¢",
    pound: "£",
    yen: "¥",
    sect: "§",
    para: "¶",
    plusmn: "±",
    times: "×",
    divide: "÷",
    agrave: "à",
    egrave: "è",
    igrave: "ì",
    ograve: "ò",
    ugrave: "ù",
    aacute: "á",
    eacute: "é",
    iacute: "í",
    oacute: "ó",
    uacute: "ú",
    Agrave: "À",
    Egrave: "È",
    Igrave: "Ì",
    Ograve: "Ò",
    Ugrave: "Ù",
    Aacute: "Á",
    Eacute: "É",
    Iacute: "Í",
    Oacute: "Ó",
    Uacute: "Ú",
    ntilde: "ñ",
    Ntilde: "Ñ",
    ccedil: "ç",
    uuml: "ü",
    Uuml: "Ü",
    hellip: "…",
    laquo: "«",
    raquo: "»",
    deg: "°",
  },
)

function numericEntity(codePoint: number): string {
  return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, decimal) => numericEntity(parseInt(decimal, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hexadecimal) => numericEntity(parseInt(hexadecimal, 16)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] ?? match)
}

function findTagEnd(input: string, start: number): number {
  let quote: '"' | "'" | null = null
  for (let index = start; index < input.length; index++) {
    const character = input[index]
    if (quote) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === ">") {
      return index
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
      text += html.slice(start, end + 1)
      cursor = end + 1
      continue
    }

    const closing = match[1] === "/"
    const name = match[2].toLowerCase()
    if (!closing && name === "br") {
      text += "\n"
    } else if (
      closing &&
      (name === "p" ||
        name === "li" ||
        name === "ul" ||
        name === "ol" ||
        name === "div" ||
        /^h[1-6]$/.test(name))
    ) {
      text += "\n"
    } else {
      text += " "
    }
    cursor = end + 1
  }

  return text
}

/** Strip tags, retain readable breaks, and decode safe named/numeric entities. */
export function stripHtml(html: unknown): string {
  if (typeof html !== "string" || !html) return ""
  return decodeHtmlEntities(stripTagsPreservingBreaks(html))
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Reshape one valid job; malformed rows are skipped instead of invented. */
export function toResult(job: ArbeitnowJob): JobResult | null {
  const title = typeof job.title === "string" && job.title.trim() ? job.title : null
  const url = typeof job.url === "string" && job.url.trim() ? job.url.trim() : null
  if (!title || !url) return null

  const slug = typeof job.slug === "string" && job.slug.trim() ? job.slug.trim() : null
  const explicitId =
    typeof job.id === "string" && job.id.trim()
      ? job.id.trim()
      : stableNumberId(job.id)
  const id = slug ?? explicitId ?? url

  return {
    id,
    portal: "arbeitnow",
    title,
    company: optionalText(job.company_name),
    location: optionalText(job.location),
    url,
    date: normalizeDate(job.created_at),
    description: stripHtml(job.description),
    remote: typeof job.remote === "boolean" ? job.remote : null,
    salary: null,
  }
}

export interface Flags {
  _: string[]
  [key: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit" }
const OPTION_NAMES = new Set(["query", "remote-only", "page", "limit", "format", "help", "h"])
const BOOLEAN_OPTIONS = new Set(["remote-only", "help", "h"])
const NUMERIC_OPTIONS = new Set(["page", "limit"])

/** Parse flags and reject unknown options, missing values, and invalid booleans. */
export function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]
    if (!argument.startsWith("-")) {
      ;(flags._ as string[]).push(argument)
      continue
    }

    const name = argument.replace(/^-+/, "")
    if (!name) throw new InvalidArgumentError(`invalid option "${argument}"`)
    const key = ALIAS[name] ?? name
    if (!OPTION_NAMES.has(key)) throw new InvalidArgumentError(`unknown option "${argument}"`)

    if (BOOLEAN_OPTIONS.has(key)) {
      flags[key] = true
      continue
    }

    const next = argv[index + 1]
    const negativeNumericValue = NUMERIC_OPTIONS.has(key) && next !== undefined && /^-\d+$/.test(next)
    if (next === undefined || (next.startsWith("-") && !negativeNumericValue)) {
      throw new InvalidArgumentError(`${argument} requires a value`)
    }
    flags[key] = next
    index++
  }
  return flags
}

export function stringFlag(flags: Flags, name: string): string | undefined {
  const value = flags[name]
  if (value === undefined) return undefined
  if (typeof value !== "string") throw new InvalidArgumentError(`--${name} requires a string value`)
  return value
}

export function booleanFlag(flags: Flags, name: string): boolean {
  const value = flags[name]
  if (value === undefined) return false
  if (typeof value !== "boolean") throw new InvalidArgumentError(`--${name} is a boolean flag`)
  return value
}

export function integerFlag(name: string, raw: string | undefined, min: number, max?: number): number {
  const range = max === undefined ? `>= ${min}` : `${min}..${max}`
  if (raw === undefined || !/^\d+$/.test(raw)) {
    if (raw !== undefined && /^-\d+$/.test(raw)) {
      throw new InvalidArgumentError(`--${name} must be in the range ${range}, got "${raw}"`)
    }
    throw new InvalidArgumentError(`--${name} must be a non-negative integer, got "${raw ?? ""}"`)
  }

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || (max !== undefined && value > max)) {
    throw new InvalidArgumentError(`--${name} must be in the range ${range}, got "${raw}"`)
  }
  return value
}
