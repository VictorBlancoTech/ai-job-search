// Data source: the official Adzuna Jobs API (https://developer.adzuna.com/) —
// a job aggregator with first-party portals for Italy (adzuna.it) and Spain
// (adzuna.es), so one client covers both markets. Authenticated with a free
// app_id/app_key pair, read from the environment or the repo's .env file.
// The search endpoint returns full descriptions inline, so there is no detail
// command: search alone satisfies the portal-skill contract.

import { readFileSync } from "node:fs"
import { join } from "node:path"

export const API_BASE = "https://api.adzuna.com/v1/api/jobs"

const UA = "adzuna-search-skill/1.0 (+https://developer.adzuna.com)"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
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

/**
 * Adzuna credentials: process.env wins, then the repo-root .env (five levels
 * up from cli/src). Returns null when either value is missing — the CLI maps
 * that to exit code 2 with a clear message.
 */
export function getCredentials(): { appId: string; appKey: string } | null {
  const fileEnv = loadEnvFile(join(import.meta.dir, "..", "..", "..", "..", "..", ".env"))
  const appId = process.env.ADZUNA_APP_ID || fileEnv.ADZUNA_APP_ID
  const appKey = process.env.ADZUNA_APP_KEY || fileEnv.ADZUNA_APP_KEY
  if (!appId || !appKey) return null
  return { appId, appKey }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * GET JSON from the Adzuna API. One retry on 429/5xx (transient states) after
 * a 2s backoff; a connection failure fails fast with a clear message, so an
 * outage degrades this source quickly rather than hanging the caller.
 */
export async function apiGet<T>(url: string): Promise<T> {
  const maxRetries = 1
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let response: Response
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
      })
    } catch (e) {
      throw new Error(
        `could not reach the Adzuna API (${e instanceof Error ? e.message : String(e)})`,
      )
    }

    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Adzuna API request failed: ${response.status} ${response.statusText}`)
      }
      await sleep(2000)
      continue
    }

    const body = (await response.json().catch(() => null)) as T | null
    if (!response.ok) {
      throw new Error(`Adzuna API request failed: ${response.status} ${response.statusText}`)
    }
    if (!body) throw new Error("Adzuna API returned an unparseable response body")
    return body
  }
  // Unreachable in practice; the loop returns or throws on the last attempt.
  throw new Error("Adzuna API request failed after retries")
}

/**
 * An Adzuna job — the fields this skill reads (the wire shape carries more,
 * e.g. latitude/longitude, category, salary_is_predicted).
 */
export interface AdzunaJob {
  id: string | number
  title?: string
  company?: { display_name?: string }
  location?: { display_name?: string; area?: string[] }
  description?: string
  created?: string
  redirect_url?: string
  salary_min?: number
  salary_max?: number
}

/** The search endpoint's response envelope. */
export interface SearchResponse {
  results?: AdzunaJob[]
  count?: number
}

/** A search result in the unified portal-skill contract shape. */
export interface JobResult {
  id: string
  portal: "adzuna"
  title: string
  company: string | null
  location: string | null
  url: string
  date: string | null
  description: string
  remote: boolean | null
  salary: string | null
}

/** "min-max EUR" when both bounds exist; null otherwise (per the contract). */
function formatSalary(min?: number, max?: number): string | null {
  if (min == null || max == null) return null
  return `${min}-${max} EUR`
}

/** Reshape an Adzuna job into the contract search-result fields. */
export function toResult(j: AdzunaJob): JobResult {
  return {
    id: String(j.id),
    portal: "adzuna",
    title: j.title || "(untitled)",
    company: j.company?.display_name || null,
    location: j.location?.display_name || null,
    url: j.redirect_url || "",
    date: j.created ? j.created.slice(0, 10) : null,
    description: stripHtml(j.description),
    // Adzuna's search API exposes no remote-work field — never guess.
    remote: null,
    salary: formatSalary(j.salary_min, j.salary_max),
  }
}

// Named entities beyond the XML basics: Latin-1 letters common in Italian and
// Spanish postings, plus a few typographic marks.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  agrave: "à", egrave: "è", igrave: "ì", ograve: "ò", ugrave: "ù",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Agrave: "À", Egrave: "È", Igrave: "Ì", Ograve: "Ò", Ugrave: "Ù",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", ccedil: "ç", uuml: "ü", Uuml: "Ü",
  hellip: "…", laquo: "«", raquo: "»", deg: "°",
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m)
}

/**
 * Strip HTML into readable prose: block/line-break tags become newlines,
 * entities are decoded, tags removed. Always returns a string ("" for empty
 * input) because the contract's description field is non-nullable.
 */
export function stripHtml(html: string | null | undefined): string {
  if (!html) return ""
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
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

/** Minimal flag parser: --flag value pairs, bare flags are boolean true. */
export function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith("-")) {
      ;(flags._ as string[]).push(a)
      continue
    }
    const name = a.replace(/^-+/, "")
    const key = ALIAS[name] ?? name
    const next = argv[i + 1]
    let value: string | boolean = true
    if (next !== undefined && !next.startsWith("-")) {
      value = next
      i++
    }
    flags[key] = value
  }
  return flags
}
