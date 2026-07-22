export const INFOJOBS_API_BASE = "https://api.infojobs.net/api"
export const INFOJOBS_SEARCH_ENDPOINT = `${INFOJOBS_API_BASE}/9/offer`
export const INFOJOBS_DETAIL_ENDPOINT = `${INFOJOBS_API_BASE}/7/offer`
export const INFOJOBS_USER_AGENT =
  "ai-job-search/infojobs-search/1.0 (+https://developer.infojobs.net/)"

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

export class MissingCredentialsError extends Error {
  readonly code = "NO_CREDENTIALS"

  constructor() {
    super("INFOJOBS_CLIENT_ID and INFOJOBS_CLIENT_SECRET are required")
    this.name = "MissingCredentialsError"
  }
}

export interface Credentials {
  clientId: string
  clientSecret: string
}

export interface Environment {
  [key: string]: string | undefined
}

export function readCredentials(env: Environment = process.env): Credentials | null {
  const clientId = typeof env.INFOJOBS_CLIENT_ID === "string" ? env.INFOJOBS_CLIENT_ID.trim() : ""
  const clientSecret = typeof env.INFOJOBS_CLIENT_SECRET === "string" ? env.INFOJOBS_CLIENT_SECRET.trim() : ""
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

export function requireCredentials(env: Environment = process.env): Credentials {
  const credentials = readCredentials(env)
  if (credentials === null) throw new MissingCredentialsError()
  return credentials
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function buildAuthHeaders(credentials: Credentials): Record<string, string> {
  return {
    Accept: "application/json",
    Authorization: `Basic ${base64Utf8(`${credentials.clientId}:${credentials.clientSecret}`)}`,
    "User-Agent": INFOJOBS_USER_AGENT,
  }
}

export interface ApiGetOptions {
  credentials?: Credentials
  env?: Environment
  fetchFn?: typeof fetch
  sleepFn?: (ms: number) => Promise<void>
  retryDelayMs?: number
  timeoutMs?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Fetch JSON from InfoJobs, retrying one rate-limit, server, or connection failure. */
export async function apiGet<T>(url: string, options: ApiGetOptions = {}): Promise<T> {
  const credentials = options.credentials ?? requireCredentials(options.env)
  const fetchFn = options.fetchFn ?? globalThis.fetch
  const sleepFn = options.sleepFn ?? sleep
  const retryDelayMs = Number.isFinite(options.retryDelayMs ?? 1000)
    ? Math.min(5000, Math.max(0, options.retryDelayMs ?? 1000))
    : 1000
  const timeoutMs = options.timeoutMs ?? 20000

  for (let attempt = 0; attempt <= 1; attempt++) {
    let response: Response
    try {
      response = await fetchFn(url, {
        headers: buildAuthHeaders(credentials),
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if (attempt === 0) {
        await sleepFn(retryDelayMs)
        continue
      }
      throw new Error(`could not reach the InfoJobs API (${error instanceof Error ? error.message : String(error)})`)
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === 1) {
        throw new Error(`InfoJobs API request failed: ${response.status} ${response.statusText}`)
      }
      await sleepFn(retryDelayMs)
      continue
    }

    const body = await response.text().catch(() => "")
    if (!response.ok) {
      throw new Error(`InfoJobs API request failed: ${response.status} ${response.statusText}`)
    }
    if (!body.trim()) throw new Error("InfoJobs API returned an unparseable response body")

    try {
      return JSON.parse(body) as T
    } catch {
      throw new Error("InfoJobs API returned an unparseable response body")
    }
  }

  throw new Error("InfoJobs API request failed after retries")
}

export interface InfoJobsOffer {
  [key: string]: unknown
  id?: unknown
  title?: unknown
  link?: unknown
  url?: unknown
  city?: unknown
  cityValue?: unknown
  province?: unknown
  provinceValue?: unknown
  author?: unknown
  company?: unknown
  profile?: unknown
  updated?: unknown
  updateDate?: unknown
  published?: unknown
  creationDate?: unknown
  createdAt?: unknown
  description?: unknown
  fullDescription?: unknown
  descriptionHtml?: unknown
  summary?: unknown
  excerpt?: unknown
  requirementMin?: unknown
  minRequirements?: unknown
  desiredRequirements?: unknown
  teleworking?: unknown
  salaryMin?: unknown
  salaryMax?: unknown
  salaryPeriod?: unknown
  minPay?: unknown
  maxPay?: unknown
  showPay?: unknown
  salaryDescription?: unknown
  salaryRange?: unknown
  salary?: unknown
}

export interface JobResult {
  id: string
  portal: "infojobs"
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

/** Validate the documented `{ offers: [...] }` search envelope. */
export function jobsFromResponse(value: unknown): InfoJobsOffer[] {
  if (!isRecord(value) || !Array.isArray(value.offers)) {
    throw new Error("InfoJobs API returned an invalid response body")
  }
  return value.offers.filter(isRecord) as InfoJobsOffer[]
}

/** Accept the documented direct detail object and common wrapped test responses. */
export function offerFromDetailResponse(value: unknown): InfoJobsOffer | null {
  if (!isRecord(value)) return null
  if (isRecord(value.offer)) return value.offer as InfoJobsOffer
  if (isRecord(value.data)) return value.data as InfoJobsOffer
  return value as InfoJobsOffer
}

function textValue(value: unknown, allowNumber = false): string | null {
  if (typeof value === "string" && value.trim()) return value.trim()
  if (allowNumber && typeof value === "number" && Number.isFinite(value)) return String(value)
  return null
}

function nestedText(value: unknown, keys: string[], allowNumber = false): string | null {
  const direct = textValue(value, allowNumber)
  if (direct !== null) return direct
  if (!isRecord(value)) return null
  for (const key of keys) {
    const result = textValue(value[key], allowNumber)
    if (result !== null) return result
  }
  return null
}

function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const text = textValue(value)
    if (text !== null) return text
  }
  return null
}

function firstDate(...values: unknown[]): string | null {
  for (const value of values) {
    const date = normalizeDate(value)
    if (date !== null) return date
  }
  return null
}

function normalizedText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
}

/** Convert a friendly province name into the API's documented key format. */
const PROVINCE_KEY_ALIASES: Record<string, string> = {
  alava: "alava",
  madrid: "madrid",
  valencia: "valencia-valencia",
  "valencia-valencia": "valencia-valencia",
}

export function normalizeProvince(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[’']/gu, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
  return PROVINCE_KEY_ALIASES[slug] ?? slug
}

function locationText(offer: InfoJobsOffer): string | null {
  const city = nestedText(offer.city ?? offer.cityValue, ["value", "name"])
  const province = nestedText(offer.province, ["value", "name"]) ?? textValue(offer.provinceValue)
  const parts = [city, province].filter((part): part is string => part !== null)
  const unique: string[] = []
  for (const part of parts) {
    if (!unique.some((existing) => normalizedText(existing) === normalizedText(part))) unique.push(part)
  }
  return unique.length > 0 ? unique.join(", ") : null
}

function companyText(offer: InfoJobsOffer): string | null {
  return (
    nestedText(offer.author, ["name", "value", "company", "label"]) ??
    nestedText(offer.company, ["name", "value", "label"]) ??
    nestedText(offer.profile, ["name", "value", "company", "label"])
  )
}

function teleworkingText(value: unknown): string {
  if (typeof value === "boolean") return value ? "remote" : "onsite"
  if (typeof value === "string") return normalizedText(value)
  if (!isRecord(value)) return ""
  return [value.value, value.key, value.name]
    .map((item) => textValue(item) ?? "")
    .filter(Boolean)
    .map(normalizedText)
    .join(" ")
}

/** Map only explicit InfoJobs remote/onsite labels; unknown labels remain null. */
export function normalizeRemote(value: unknown): boolean | null {
  if (typeof value === "boolean") return value
  const token = teleworkingText(value)
  if (!token) return null
  if (/teletrabaj|telework|remote|remot[oa]/u.test(token)) return true
  if (/presencial|onsite|on-site/u.test(token)) return false
  return null
}

function explicitSalaryText(value: unknown, keys = ["amountValue", "value", "text", "label", "amount"]): string | null {
  const text = nestedText(value, keys, true)
  if (text === null || !/\d/u.test(text)) return null
  return stripHtml(text)
}

interface SalaryPart {
  amount: string | null
  period: string | null
}

function salaryPart(value: unknown): SalaryPart {
  return {
    amount: explicitSalaryText(value),
    period: nestedText(value, ["periodValue", "period", "salaryPeriod"]),
  }
}

function formatSalary(offer: InfoJobsOffer): string | null {
  if (offer.showPay === false) return null
  const minPay = salaryPart(offer.minPay)
  const maxPay = salaryPart(offer.maxPay)
  const legacyMin = salaryPart(offer.salaryMin)
  const legacyMax = salaryPart(offer.salaryMax)
  const min = minPay.amount ?? legacyMin.amount
  const max = maxPay.amount ?? legacyMax.amount
  const period =
    minPay.period ??
    maxPay.period ??
    nestedText(offer.salaryPeriod, ["value", "name", "label"])
  let range: string | null = null

  if (min !== null || max !== null) range = min !== null && max !== null ? `${min}-${max}` : min ?? max

  if (range === null) {
    for (const candidate of [offer.salaryDescription, offer.salaryRange, offer.salary]) {
      const explicit = explicitSalaryText(candidate)
      if (explicit !== null) {
        range = explicit
        break
      }
    }
  }

  if (range === null) return null
  return period !== null && !range.includes(period) ? `${range} ${period}` : range
}

function descriptionText(offer: InfoJobsOffer, detail: boolean): string {
  const candidates = detail
    ? [offer.description, offer.fullDescription, offer.descriptionHtml, offer.minRequirements, offer.requirementMin, offer.desiredRequirements]
    : [offer.description, offer.summary, offer.excerpt, offer.requirementMin, offer.minRequirements]
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue
    const cleaned = stripHtml(candidate)
    if (cleaned) return cleaned
  }
  return ""
}

function resultDate(offer: InfoJobsOffer): string | null {
  return firstDate(
    offer.updated,
    offer.updateDate,
    offer.published,
    offer.creationDate,
    offer.createdAt,
  )
}

/** Reshape one offer; malformed rows are skipped rather than invented. */
export function toResult(offer: InfoJobsOffer, fallbackId?: string): JobResult | null {
  const id = nestedText(offer.id, [], true) ?? textValue(offer.offerId, true) ?? textValue(fallbackId)
  const title = textValue(offer.title)
  const url = firstText(offer.link, offer.url)
  if (id === null || title === null || url === null) return null

  return {
    id,
    portal: "infojobs",
    title,
    company: companyText(offer),
    location: locationText(offer),
    url,
    date: resultDate(offer),
    description: descriptionText(offer, false),
    remote: normalizeRemote(offer.teleworking),
    salary: formatSalary(offer),
  }
}

/** Reshape a detail response and prefer its full description field. */
export function toDetail(offer: InfoJobsOffer, fallbackId?: string): JobResult | null {
  const result = toResult(offer, fallbackId)
  if (result === null) return null
  return {
    ...result,
    description: descriptionText(offer, true),
  }
}

interface XmlTag {
  start: number
  end: number
  name: string | null
  closing: boolean
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

function scanTag(input: string, cursor: number): XmlTag | null {
  const start = input.indexOf("<", cursor)
  if (start === -1) return null
  if (input.startsWith("<!--", start)) {
    const end = input.indexOf("-->", start + 4)
    return { start, end: end === -1 ? input.length : end + 3, name: null, closing: false, special: true }
  }
  const end = findTagEnd(input, start + 1)
  if (end === -1) return null
  const inner = input.slice(start + 1, end)
  const match = inner.match(/^\s*(\/?)\s*([A-Za-z][A-Za-z0-9_.:-]*)\b/)
  return {
    start,
    end: end + 1,
    name: match?.[2]?.toLowerCase() ?? null,
    closing: match?.[1] === "/",
    special: false,
  }
}

const NAMED_ENTITIES: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
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
})

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
    const tag = scanTag(html, start)
    if (tag === null) {
      text += html.slice(start)
      break
    }
    if (tag.name === null) {
      if (!tag.special) text += html.slice(tag.start, tag.end)
      cursor = tag.end
      continue
    }
    if (!tag.closing && tag.name === "br") {
      if (!text.endsWith("\n")) text += "\n"
    } else if (tag.closing && (tag.name === "p" || tag.name === "li" || tag.name === "ul" || tag.name === "ol" || tag.name === "div" || /^h[1-6]$/u.test(tag.name))) {
      if (!text.endsWith("\n")) text += "\n"
    }
    else text += " "
    cursor = tag.end
  }
  return text
}

/** Strip markup, retain readable breaks, and decode safe named/numeric entities. */
export function stripHtml(value: unknown): string {
  if (typeof value !== "string" || !value) return ""
  return decodeHtmlEntities(stripTagsPreservingBreaks(value))
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\r\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function validCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function formatDate(date: Date): string | null {
  if (!Number.isFinite(date.getTime())) return null
  const year = date.getUTCFullYear()
  return year >= 0 && year <= 9999 ? date.toISOString().slice(0, 10) : null
}

function normalizeIsoDate(value: string): string | null {
  const match = value.trim().match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|GMT|UTC|[+-]\d{2}:?\d{2})?)?$/i,
  )
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = match[4] === undefined ? 0 : Number(match[4])
  const minute = match[5] === undefined ? 0 : Number(match[5])
  const second = match[6] === undefined ? 0 : Number(match[6])
  if (!validCalendarDate(year, month, day) || hour > 23 || minute > 59 || second > 59) return null

  const timezone = match[7]
  if (timezone !== undefined && !/^(?:Z|GMT|UTC)$/i.test(timezone)) {
    const offset = timezone.match(/^[+-](\d{2}):?(\d{2})$/)
    if (offset === null || Number(offset[1]) > 23 || Number(offset[2]) > 59) return null
  }
  return `${match[1]}-${match[2]}-${match[3]}`
}

/** Normalize API dates without allowing JavaScript date rollover. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? formatDate(new Date(value * 1000)) : null
  }
  if (value instanceof Date) return formatDate(value)
  if (typeof value !== "string") return null
  return normalizeIsoDate(value)
}

export interface Flags {
  _: string[]
  [key: string]: string | boolean | string[]
}

const ALIAS: Record<string, string> = { q: "query", l: "where", n: "limit" }
const OPTION_NAMES = new Set(["query", "where", "teleworking", "page", "limit", "format", "help", "h"])
const BOOLEAN_OPTIONS = new Set(["teleworking", "help", "h"])
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
