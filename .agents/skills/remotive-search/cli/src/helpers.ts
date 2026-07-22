import { URLSearchParams } from "node:url"

export const API_BASE = "https://remotive.com/api/remote-jobs"

const UA = "remotive-search-skill/1.0 (+https://remotive.com/api-documentation)"

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

/** Fetch JSON, retrying one transient response before reporting the failure. */
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
    } catch (error) {
      throw new Error(
        `could not reach the Remotive API (${error instanceof Error ? error.message : String(error)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Remotive API request failed: ${response.status} ${response.statusText}`)
      }
      await sleepFn(retryDelayMs)
      continue
    }

    const body = (await response.json().catch(() => null)) as T | null
    if (!response.ok) {
      throw new Error(`Remotive API request failed: ${response.status} ${response.statusText}`)
    }
    if (!body) throw new Error("Remotive API returned an unparseable response body")
    return body
  }

  throw new Error("Remotive API request failed after retries")
}

export interface RemotiveJob {
  id: string | number
  url: string
  title: string
  company_name?: string | null
  category?: string | null
  job_type?: string | null
  publication_date?: string | null
  candidate_required_location?: string | null
  salary?: string | null
  description?: string | null
}

export interface SearchResponse {
  jobs?: RemotiveJob[]
  "job-count"?: number
  "total-job-count"?: number
}

export interface JobResult {
  id: string
  portal: "remotive"
  title: string
  company: string | null
  location: string | null
  url: string
  date: string | null
  description: string
  remote: true
  salary: string | null
}

export function toResult(job: RemotiveJob): JobResult {
  return {
    id: String(job.id),
    portal: "remotive",
    title: job.title,
    company: job.company_name || null,
    location: job.candidate_required_location || null,
    url: job.url,
    date: job.publication_date ? job.publication_date.slice(0, 10) : null,
    description: stripHtml(job.description || ""),
    remote: true,
    salary: job.salary || null,
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

/** Strip tags while retaining readable line breaks and decoding safe entities. */
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
  [key: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit" }
const OPTION_NAMES = new Set(["query", "limit", "category", "format", "help", "h"])
const BOOLEAN_OPTIONS = new Set(["help", "h"])
const NUMERIC_OPTIONS = new Set(["limit"])

/** Parse CLI flags and reject unknown options or missing values. */
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

export function encodeQuery(params: Record<string, string | undefined>): string {
  const searchParams = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) searchParams.set(key, value)
  }
  return searchParams.toString()
}
