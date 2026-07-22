import { createHash } from "node:crypto"

export const WWR_RSS_BASE = "https://weworkremotely.com/categories"
export const HIMALAYAS_API_BASE = "https://himalayas.app/jobs/api"
export const VERIFIED_WWR_CATEGORIES = [
  "remote-programming-jobs",
  "remote-management-and-finance-jobs",
  "remote-product-jobs",
  "remote-devops-sysadmin-jobs",
] as const
export const DEFAULT_CATEGORIES = [
  "remote-programming-jobs",
  "remote-management-and-finance-jobs",
] as const
export const WWR_USER_AGENT =
  "ai-job-search/wwr-search/1.0 (personal use, github.com/VictorBlancoTech/ai-job-search)"

export type Portal = "wwr" | "himalayas"
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

export interface RequestOptions {
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
  retryDelayMs?: number
  timeoutMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function sourceName(url: string): string {
  return url.includes("himalayas.app") ? "Himalayas" : "WWR"
}

function retryDelay(options: RequestOptions): number {
  const value = options.retryDelayMs ?? 1000
  return Number.isFinite(value) ? Math.min(5000, Math.max(0, value)) : 1000
}

async function requestText(url: string, options: RequestOptions = {}): Promise<string> {
  const fetchFn = options.fetchFn ?? globalThis.fetch
  const sleepFn = options.sleepFn ?? sleep
  const source = sourceName(url)

  for (let attempt = 0; attempt <= 1; attempt++) {
    let response: Response
    try {
      response = await fetchFn(url, {
        headers: {
          Accept: url.includes("himalayas.app") ? "application/json" : "application/rss+xml, application/xml",
          "User-Agent": WWR_USER_AGENT,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      })
    } catch (error) {
      throw new Error(`could not reach ${source} (${error instanceof Error ? error.message : String(error)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === 1) {
        throw new Error(`${source} request failed: ${response.status} ${response.statusText}`)
      }
      await sleepFn(retryDelay(options))
      continue
    }

    if (!response.ok) throw new Error(`${source} request failed: ${response.status} ${response.statusText}`)

    const body = await response.text().catch(() => "")
    if (!body) throw new Error(`${source} returned an unparseable response body`)
    return body
  }

  throw new Error(`${source} request failed after retries`)
}

/** Fetch public JSON, retrying one rate-limit or server failure. */
export async function apiGet<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const source = sourceName(url)
  const body = await requestText(url, options)
  try {
    const parsed: unknown = JSON.parse(body)
    if (parsed === null) throw new Error("null body")
    return parsed as T
  } catch {
    throw new Error(`${source} returned an unparseable response body`)
  }
}

export async function apiGetText(url: string, options: RequestOptions = {}): Promise<string> {
  return requestText(url, options)
}

export interface WwrJob {
  title: string | null
  link: string | null
  pubDate: string | null
  description: string | null
  region: string | null
}

export interface HimalayasJob {
  [key: string]: unknown
  id?: unknown
  slug?: unknown
  title?: unknown
  companyName?: unknown
  company?: unknown
  location?: unknown
  locationRestrictions?: unknown
  description?: unknown
  excerpt?: unknown
  applicationLink?: unknown
  url?: unknown
  guid?: unknown
  pubDate?: unknown
  date?: unknown
  minSalary?: unknown
  maxSalary?: unknown
  salaryPeriod?: unknown
  currency?: unknown
}

export interface HimalayasResponse {
  updatedAt?: unknown
  offset?: unknown
  limit?: unknown
  totalCount?: unknown
  jobs?: unknown
}

export interface JobResult {
  id: string
  portal: Portal
  title: string
  company: string | null
  location: string | null
  url: string
  date: string | null
  description: string
  remote: true
  salary: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function jobsFromHimalayasResponse(value: unknown): HimalayasJob[] {
  if (!isRecord(value) || !Array.isArray(value.jobs)) {
    throw new Error("Himalayas API returned an invalid response body")
  }
  return value.jobs.filter(isRecord) as HimalayasJob[]
}

interface XmlTag {
  start: number
  end: number
  name: string | null
  closing: boolean
  selfClosing: boolean
  special: boolean
}

function findTagEnd(input: string, start: number): number {
  let quote: '"' | "'" | null = null
  for (let index = start; index < input.length; index++) {
    const character = input[index]
    if (quote !== null) {
      if (character === quote) quote = null
    } else if (character === '"' || character === "'") {
      quote = character
    } else if (character === ">") {
      return index
    }
  }
  return -1
}

function scanNextTag(input: string, cursor: number): XmlTag | null {
  const start = input.indexOf("<", cursor)
  if (start === -1) return null

  if (input.startsWith("<!--", start)) {
    const commentEnd = input.indexOf("-->", start + 4)
    return {
      start,
      end: commentEnd === -1 ? input.length : commentEnd + 3,
      name: null,
      closing: false,
      selfClosing: true,
      special: true,
    }
  }

  if (input.startsWith("<![CDATA[", start)) {
    const cdataEnd = input.indexOf("]]>", start + 9)
    return {
      start,
      end: cdataEnd === -1 ? input.length : cdataEnd + 3,
      name: null,
      closing: false,
      selfClosing: true,
      special: true,
    }
  }

  const tagEnd = findTagEnd(input, start + 1)
  if (tagEnd === -1) return null
  const inner = input.slice(start + 1, tagEnd)
  const match = inner.match(/^\s*(\/?)\s*([A-Za-z][A-Za-z0-9_.:-]*)\b([\s\S]*)$/)
  return {
    start,
    end: tagEnd + 1,
    name: match?.[2]?.toLowerCase() ?? null,
    closing: match?.[1] === "/",
    selfClosing: match !== null && /\/\s*$/.test(inner),
    special: false,
  }
}

function findMatchingClose(input: string, from: number, tagName: string): XmlTag | null {
  let cursor = from
  let depth = 1
  while (cursor < input.length) {
    const tag = scanNextTag(input, cursor)
    if (tag === null) return null
    cursor = tag.end
    if (tag.special || tag.name !== tagName) continue
    if (tag.closing) {
      depth--
      if (depth === 0) return tag
    } else if (!tag.selfClosing) {
      depth++
    }
  }
  return null
}

function extractTagContent(input: string, requestedName: string): string | null {
  const tagName = requestedName.toLowerCase()
  let cursor = 0
  while (cursor < input.length) {
    const tag = scanNextTag(input, cursor)
    if (tag === null) return null
    cursor = tag.end
    if (tag.special || tag.closing || tag.name !== tagName) continue
    if (tag.selfClosing) return ""
    const close = findMatchingClose(input, tag.end, tagName)
    return close === null ? null : input.slice(tag.end, close.start)
  }
  return null
}

function scanRssItems(xml: string): string[] {
  const items: string[] = []
  let cursor = 0
  while (cursor < xml.length) {
    const tag = scanNextTag(xml, cursor)
    if (tag === null) break
    cursor = tag.end
    if (tag.special || tag.closing || tag.name !== "item") continue
    const close = findMatchingClose(xml, tag.end, "item")
    if (close === null) continue
    items.push(xml.slice(tag.end, close.start))
    cursor = close.end
  }
  return items
}

function unwrapCdata(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
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
    euro: "\u20ac",
    ndash: "\u2013",
    mdash: "\u2014",
    copy: "\u00a9",
    bull: "\u2022",
    trade: "\u2122",
    middot: "\u00b7",
    rsquo: "\u2019",
    lsquo: "\u2018",
    rdquo: "\u201d",
    ldquo: "\u201c",
    cent: "\u00a2",
    pound: "\u00a3",
    yen: "\u00a5",
    sect: "\u00a7",
    para: "\u00b6",
    plusmn: "\u00b1",
    times: "\u00d7",
    divide: "\u00f7",
    agrave: "\u00e0",
    egrave: "\u00e8",
    igrave: "\u00ec",
    ograve: "\u00f2",
    ugrave: "\u00f9",
    aacute: "\u00e1",
    eacute: "\u00e9",
    iacute: "\u00ed",
    oacute: "\u00f3",
    uacute: "\u00fa",
    ntilde: "\u00f1",
    Ntilde: "\u00d1",
    ccedil: "\u00e7",
    uuml: "\u00fc",
    Uuml: "\u00dc",
    hellip: "\u2026",
    laquo: "\u00ab",
    raquo: "\u00bb",
    deg: "\u00b0",
  },
)

function numericEntity(codePoint: number): string {
  if (codePoint < 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return ""
  return String.fromCodePoint(codePoint)
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, decimal: string) => numericEntity(Number.parseInt(decimal, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hexadecimal: string) => numericEntity(Number.parseInt(hexadecimal, 16)))
    .replace(/&([a-zA-Z]+);/g, (match: string, name: string) => NAMED_ENTITIES[name] ?? match)
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
    if (match === null) {
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
export function stripHtml(value: unknown): string {
  if (typeof value !== "string" || !value) return ""
  return decodeHtmlEntities(stripTagsPreservingBreaks(value))
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function cleanXmlField(value: string | null): string | null {
  if (value === null) return null
  const cleaned = decodeHtmlEntities(unwrapCdata(value)).trim()
  return cleaned || null
}

export function jobsFromRss(value: unknown): WwrJob[] {
  if (typeof value !== "string" || !/<rss(?:\s|>)/i.test(value)) {
    throw new Error("WWR RSS returned an invalid response body")
  }

  return scanRssItems(value).map((item) => ({
    title: cleanXmlField(extractTagContent(item, "title")),
    link: cleanXmlField(extractTagContent(item, "link")),
    pubDate: cleanXmlField(extractTagContent(item, "pubDate")),
    description: cleanXmlField(extractTagContent(item, "description")),
    region: cleanXmlField(extractTagContent(item, "region")),
  }))
}

function optionalText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function stableValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function normalizedLink(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    url.protocol = url.protocol.toLowerCase()
    url.hostname = url.hostname.toLowerCase()
    url.hash = ""
    return url.toString()
  } catch {
    return trimmed
  }
}

export function stableHash(value: string): string {
  return createHash("sha256").update(normalizedLink(value)).digest("hex")
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
  return year >= 0 && year <= 9999 ? date.toISOString().slice(0, 10) : null
}

function dateFromUtcParts(year: number, month: number, day: number, hour: number, minute: number, second: number): Date {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(hour, minute, second, 0)
  return date
}

function normalizeIsoDate(value: string): string | null {
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})?)?$/,
  )
  if (match === null) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  if (!validCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null

  const offset = match[7]
  if (offset !== undefined && offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3))
    const offsetMinute = Number(offset.slice(4, 6))
    if (offsetHour > 23 || offsetMinute > 59) return null
  }
  return `${match[1]}-${match[2]}-${match[3]}`
}

const RFC_MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

function normalizeRfcDate(value: string): string | null {
  const match = value.trim().match(
    /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+(Z|GMT|UTC|[+-]\d{4}|[+-]\d{2}:\d{2})$/i,
  )
  if (match === null) return null

  const day = Number(match[1])
  const month = RFC_MONTHS[match[2].toLowerCase()]
  const year = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  if (month === undefined || !validCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) {
    return null
  }

  const timezone = match[7]
  let offsetMinutes = 0
  if (timezone.toUpperCase() !== "Z" && timezone.toUpperCase() !== "GMT" && timezone.toUpperCase() !== "UTC") {
    const offsetMatch = timezone.match(/^([+-])(\d{2}):?(\d{2})$/)
    if (offsetMatch === null) return null
    const offsetHour = Number(offsetMatch[2])
    const offsetMinute = Number(offsetMatch[3])
    if (offsetHour > 23 || offsetMinute > 59) return null
    offsetMinutes = (offsetHour * 60 + offsetMinute) * (offsetMatch[1] === "+" ? 1 : -1)
  }

  const date = dateFromUtcParts(year, month, day, hour, minute, second)
  return formatDate(new Date(date.getTime() - offsetMinutes * 60_000))
}

export function normalizeDate(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? formatDate(new Date(value * 1000)) : null
  }
  if (value instanceof Date) return formatDate(value)
  if (typeof value !== "string") return null
  return normalizeIsoDate(value) ?? normalizeRfcDate(value)
}

function splitWwrTitle(value: string): { title: string; company: string | null } {
  const separator = value.indexOf(":")
  if (separator === -1) return { title: value, company: null }
  const company = value.slice(0, separator).trim()
  const title = value.slice(separator + 1).trim()
  return { title: title || value, company: company || null }
}

export function toWwrResult(job: WwrJob): JobResult | null {
  const url = optionalText(job.link)
  if (url === null) return null
  const rawTitle = stripHtml(job.title)
  if (!rawTitle) return null
  const split = splitWwrTitle(rawTitle)

  return {
    id: stableHash(url),
    portal: "wwr",
    title: split.title,
    company: split.company,
    location: stripHtml(job.region) || "Remote",
    url,
    date: normalizeDate(job.pubDate),
    description: stripHtml(job.description),
    remote: true,
    salary: null,
  }
}

function locationText(job: HimalayasJob): string {
  if (Array.isArray(job.locationRestrictions)) {
    const locations = job.locationRestrictions.filter(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    )
    if (locations.length > 0) return locations.join(", ")
    return "Worldwide"
  }
  return optionalText(job.location) ?? "Worldwide"
}

function finiteSalary(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null
}

function formatSalary(job: HimalayasJob): string | null {
  const min = finiteSalary(job.minSalary)
  const max = finiteSalary(job.maxSalary)
  if (min === null && max === null) return null
  const range = min !== null && max !== null ? `${min}-${max}` : String(min ?? max)
  const currency = optionalText(job.currency)
  const period = optionalText(job.salaryPeriod)
  return [currency, range, period].filter((value): value is string => value !== null).join(" ") || null
}

export function toHimalayasResult(job: HimalayasJob): JobResult | null {
  const title = stripHtml(job.title)
  const url = stableValue(job.applicationLink) ?? stableValue(job.url) ?? stableValue(job.guid)
  if (!title || url === null) return null

  const id =
    stableValue(job.id) ??
    stableValue(job.slug) ??
    stableValue(job.guid) ??
    stableValue(job.applicationLink) ??
    url
  const descriptionValue = typeof job.description === "string" ? job.description : job.excerpt

  return {
    id,
    portal: "himalayas",
    title,
    company: optionalText(job.companyName) ?? optionalText(job.company),
    location: locationText(job),
    url,
    date: normalizeDate(job.pubDate ?? job.date),
    description: stripHtml(descriptionValue),
    remote: true,
    salary: formatSalary(job),
  }
}

export interface Flags {
  _: string[]
  [key: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", n: "limit" }
const OPTION_NAMES = new Set(["query", "source", "category", "limit", "format", "help", "h"])
const BOOLEAN_OPTIONS = new Set(["help", "h"])
const NUMERIC_OPTIONS = new Set(["limit"])

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

    if (key === "category") {
      const previous = flags[key]
      if (previous === undefined) flags[key] = next
      else if (Array.isArray(previous)) flags[key] = [...previous, next]
      else if (typeof previous === "string") flags[key] = [previous, next]
      else throw new InvalidArgumentError("--category requires a string value")
    } else {
      flags[key] = next
    }
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

export function stringValuesFlag(flags: Flags, name: string): string[] {
  const value = flags[name]
  if (value === undefined) return []
  if (typeof value === "string") return [value]
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value
  throw new InvalidArgumentError(`--${name} requires a string value`)
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
