export const API_BASE = "https://remoteok.com/api"
export const REMOTEOK_USER_AGENT =
  "ai-job-search/1.0 (personal use, github.com/VictorBlancoTech/ai-job-search)"

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

/** Fetch the public JSON endpoint with a clear identity and one transient retry. */
export async function apiGet<T>(url: string, options: ApiGetOptions = {}): Promise<T> {
  const fetchFn = options.fetchFn ?? globalThis.fetch
  const sleepFn = options.sleepFn ?? sleep
  const retryDelayMs = options.retryDelayMs ?? 2000

  for (let attempt = 0; attempt <= 1; attempt++) {
    let response: Response
    try {
      response = await fetchFn(url, {
        headers: { Accept: "application/json", "User-Agent": REMOTEOK_USER_AGENT },
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      })
    } catch (error) {
      throw new Error(
        `could not reach the RemoteOK API (${error instanceof Error ? error.message : String(error)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === 1) {
        throw new Error(`RemoteOK API request failed: ${response.status} ${response.statusText}`)
      }
      await sleepFn(retryDelayMs)
      continue
    }

    if (!response.ok) {
      throw new Error(`RemoteOK API request failed: ${response.status} ${response.statusText}`)
    }

    const body = await response.json().catch(() => null)
    if (body === null) throw new Error("RemoteOK API returned an unparseable response body")
    return body as T
  }

  throw new Error("RemoteOK API request failed after retries")
}

export interface RemoteOkJob {
  id: string | number
  date?: unknown
  company?: string | null
  position?: string | null
  tags?: unknown
  description?: unknown
  location?: string | null
  url?: string | null
  salary_min?: number | null
  salary_max?: number | null
}

export interface JobResult {
  id: string
  portal: "remoteok"
  title: string
  company: string | null
  location: string
  url: string
  date: string | null
  description: string
  remote: true
  salary: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isRemoteOkJob(value: unknown): value is RemoteOkJob {
  if (!isRecord(value)) return false
  return typeof value.id === "string" || typeof value.id === "number"
}

/** Skip the API's legal metadata and ignore malformed array entries. */
export function jobsFromResponse(value: unknown): RemoteOkJob[] {
  if (!Array.isArray(value)) throw new Error("RemoteOK API returned an invalid response body")
  return value.slice(1).filter(isRemoteOkJob)
}

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function positiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null
}

function formatSalary(minValue: unknown, maxValue: unknown): string | null {
  const min = positiveNumber(minValue)
  const max = positiveNumber(maxValue)
  return min !== null && max !== null ? `${min}-${max}` : null
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

function normalizeDate(value: unknown): string | null {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null
    const year = value.getUTCFullYear()
    return year >= 0 && year <= 9999 ? value.toISOString().slice(0, 10) : null
  }
  if (typeof value !== "string") return null

  const dateText = value.trim()
  if (!dateText) return null
  const isoDate = dateText.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/,
  )
  if (!isoDate) return null

  const year = Number(isoDate[1])
  const month = Number(isoDate[2])
  const day = Number(isoDate[3])
  const hour = isoDate[4] === undefined ? 0 : Number(isoDate[4])
  const minute = isoDate[5] === undefined ? 0 : Number(isoDate[5])
  const second = isoDate[6] === undefined ? 0 : Number(isoDate[6])
  if (!validCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return null
  }

  const offset = isoDate[7]
  if (offset && offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3))
    const offsetMinute = Number(offset.slice(4, 6))
    if (offsetHour > 23 || offsetMinute > 59) return null
  }
  return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`
}

export function toResult(job: RemoteOkJob): JobResult {
  const id = String(job.id)
  return {
    id,
    portal: "remoteok",
    title: text(job.position) || "(untitled)",
    company: text(job.company) || null,
    location: text(job.location) || "Worldwide",
    url: text(job.url) || `https://remoteok.com/remote-jobs/${id}`,
    date: normalizeDate(job.date),
    description: stripHtml(job.description),
    remote: true,
    salary: formatSalary(job.salary_min, job.salary_max),
  }
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

function decodeHtmlEntities(textValue: string): string {
  return textValue
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
  let textValue = ""
  let cursor = 0

  while (cursor < html.length) {
    const start = html.indexOf("<", cursor)
    if (start === -1) {
      textValue += html.slice(cursor)
      break
    }

    textValue += html.slice(cursor, start)

    if (html.startsWith("<!--", start)) {
      const commentEnd = html.indexOf("-->", start + 4)
      if (commentEnd === -1) break
      cursor = commentEnd + 3
      continue
    }

    const end = findTagEnd(html, start + 1)
    if (end === -1) {
      textValue += html.slice(start)
      break
    }

    const content = html.slice(start + 1, end)
    const match = content.match(/^\s*(\/?)\s*([A-Za-z][A-Za-z0-9:-]*)\b/)
    if (!match) {
      textValue += html.slice(start, end + 1)
      cursor = end + 1
      continue
    }

    const closing = match[1] === "/"
    const name = match[2].toLowerCase()
    if (!closing && name === "br") {
      textValue += "\n"
    } else if (
      closing &&
      (name === "p" ||
        name === "li" ||
        name === "ul" ||
        name === "ol" ||
        name === "div" ||
        /^h[1-6]$/.test(name))
    ) {
      textValue += "\n"
    } else {
      textValue += " "
    }
    cursor = end + 1
  }

  return textValue
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

export interface Flags {
  _: string[]
  [key: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit" }
const OPTION_NAMES = new Set(["query", "tag", "limit", "format", "help", "h"])
const BOOLEAN_OPTIONS = new Set(["help", "h"])
const NUMERIC_OPTIONS = new Set(["limit"])

/** Parse flags and reject unknown options, missing values, and accidental booleans. */
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

export function integerFlag(name: string, raw: string | undefined, min: number, max: number): number {
  if (raw === undefined || !/^\d+$/.test(raw)) {
    if (raw !== undefined && /^-\d+$/.test(raw)) {
      throw new InvalidArgumentError(`--${name} must be in the range ${min}..${max}, got "${raw}"`)
    }
    throw new InvalidArgumentError(`--${name} must be a non-negative integer, got "${raw ?? ""}"`)
  }

  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new InvalidArgumentError(`--${name} must be in the range ${min}..${max}, got "${raw}"`)
  }
  return value
}
