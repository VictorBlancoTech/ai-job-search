import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  apiGet,
  buildAuthHeaders,
  INFOJOBS_API_BASE,
  INFOJOBS_DETAIL_ENDPOINT,
  INFOJOBS_SEARCH_ENDPOINT,
  type Credentials,
} from "../src/helpers"
import {
  buildDetailUrl,
  buildSearchUrl,
  runDetail,
  runSearch,
  type DetailOpts,
  type SearchOpts,
} from "../src/commands"

const searchFixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search.json"), "utf8"),
) as unknown
const detailFixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "detail.json"), "utf8"),
) as unknown
const credentials: Credentials = { clientId: "test-client", clientSecret: "test-secret" }

function captureOutput(): { get: () => string; restore: () => void } {
  let output = ""
  const originalWrite = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stdout.write
  return {
    get: () => output,
    restore: () => {
      process.stdout.write = originalWrite
    },
  }
}

function jsonResponse(body: unknown, status = 200, statusText = "OK"): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  })
}

function searchOpts(overrides: Partial<SearchOpts> = {}): SearchOpts {
  return {
    query: "responsable IT",
    where: "Madrid",
    teleworking: false,
    page: 1,
    limit: 3,
    format: "json",
    ...overrides,
  }
}

function detailOpts(overrides: Partial<DetailOpts> = {}): DetailOpts {
  return { id: "abc123remote", format: "json", ...overrides }
}

describe("InfoJobs URLs and authentication", () => {
  test("uses documented parameter names and URL encodes values", () => {
    const parsed = new URL(buildSearchUrl(searchOpts({ query: "responsable IT", where: "Madrid", teleworking: true })))
    expect(parsed.origin + parsed.pathname).toBe(INFOJOBS_SEARCH_ENDPOINT)
    expect(parsed.searchParams.get("q")).toBe("responsable IT")
    expect(parsed.searchParams.get("province")).toBe("madrid")
    expect(parsed.searchParams.get("teleworking")).toBe("solo-teletrabajo")
    expect(parsed.searchParams.get("page")).toBe("1")
    expect(parsed.searchParams.get("maxResults")).toBe("3")
    const diacriticProvince = new URL(buildSearchUrl(searchOpts({ where: "Álava" })))
    expect(diacriticProvince.searchParams.get("province")).toBe("alava")
    expect(buildDetailUrl("id/con espacios")).toBe(`${INFOJOBS_DETAIL_ENDPOINT}/id%2Fcon%20espacios`)
    expect(INFOJOBS_SEARCH_ENDPOINT).toBe(`${INFOJOBS_API_BASE}/9/offer`)
    expect(INFOJOBS_DETAIL_ENDPOINT).toBe(`${INFOJOBS_API_BASE}/7/offer`)
  })

  test("builds Basic auth and descriptive User-Agent without exposing raw credentials", () => {
    const headers = buildAuthHeaders(credentials)
    expect(headers.Authorization).toBe(`Basic ${btoa("test-client:test-secret")}`)
    expect(headers["User-Agent"]).toContain("infojobs-search")
    expect(headers["User-Agent"]).toContain("developer.infojobs.net")
  })

  test("sends auth headers and retries one transient API response", async () => {
    let calls = 0
    const delays: number[] = []
    let requestHeaders: Headers | undefined
    const response = await apiGet<{ offers: [] }>(INFOJOBS_SEARCH_ENDPOINT, {
      credentials,
      retryDelayMs: 0,
      sleepFn: async (ms) => delays.push(ms),
      fetchFn: async (_url, init) => {
        calls++
        requestHeaders = new Headers(init?.headers)
        return calls === 1 ? new Response(null, { status: 503, statusText: "Service Unavailable" }) : jsonResponse({ offers: [] })
      },
    })

    expect(response).toEqual({ offers: [] })
    expect(calls).toBe(2)
    expect(delays).toEqual([0])
    expect(requestHeaders?.get("authorization")).toBe(`Basic ${btoa("test-client:test-secret")}`)
    expect(requestHeaders?.get("user-agent")).toContain("infojobs-search")
  })
})

describe("search and detail commands", () => {
  test("prints complete normalized JSON search results and meta", async () => {
    const output = captureOutput()
    const errors: Array<{ error: string; code: string }> = []
    try {
      const exitCode = await runSearch(searchOpts(), {
        credentials,
        fetchFn: async () => jsonResponse(searchFixture),
        writeError: (error, code) => errors.push({ error, code }),
      })

      expect(exitCode).toBe(0)
      expect(errors).toEqual([])
      const payload = JSON.parse(output.get()) as { meta: Record<string, unknown>; results: Array<Record<string, unknown>> }
      expect(payload.meta).toEqual({ portal: "infojobs", count: 2, query: "responsable IT", location: "Madrid" })
      expect(payload.results[0]).toMatchObject({ id: "abc123remote", remote: true })
      expect(payload.results[1]).toMatchObject({ id: "def456onsite", remote: false })
    } finally {
      output.restore()
    }
  })

  test("renders table and plain summaries", async () => {
    const table = captureOutput()
    try {
      expect(
        await runSearch(searchOpts({ format: "table", limit: 1 }), {
          credentials,
          fetchFn: async () => jsonResponse(searchFixture),
        }),
      ).toBe(0)
      expect(table.get()).toContain("TITLE")
      expect(table.get()).toContain("Responsable IT")
      expect(table.get()).toContain("yes")
    } finally {
      table.restore()
    }

    const plain = captureOutput()
    try {
      expect(
        await runSearch(searchOpts({ format: "plain", limit: 1 }), {
          credentials,
          fetchFn: async () => jsonResponse(searchFixture),
        }),
      ).toBe(0)
      expect(plain.get()).toContain("portal: infojobs")
      expect(plain.get()).toContain("https://www.infojobs.net/madrid/responsable-it/of-abc123remote")
    } finally {
      plain.restore()
    }
  })

  test("returns structured exit 1 on API and malformed-response failures", async () => {
    const errors: Array<{ error: string; code: string }> = []
    const exitCode = await runSearch(searchOpts(), {
      credentials,
      fetchFn: async () => new Response("not-json", { status: 200 }),
      writeError: (error, code) => errors.push({ error, code }),
    })
    expect(exitCode).toBe(1)
    expect(errors[0]?.code).toBe("SEARCH_FAILED")
    expect(errors[0]?.error).not.toContain(credentials.clientSecret)
  })

  test("prints the full detail description and returns API failures as exit 1", async () => {
    const output = captureOutput()
    try {
      expect(
        await runDetail(detailOpts(), {
          credentials,
          fetchFn: async () => jsonResponse(detailFixture),
        }),
      ).toBe(0)
      const result = JSON.parse(output.get()) as Record<string, unknown>
      expect(result.description).toBe("Descripción completa & segura.\nResponsabilidades")
      expect(result.remote).toBe(true)
    } finally {
      output.restore()
    }

    const errors: Array<{ error: string; code: string }> = []
    expect(
      await runDetail(detailOpts({ id: "missing" }), {
        credentials,
        fetchFn: async () => jsonResponse({ error: "not found" }, 404, "Not Found"),
        writeError: (error, code) => errors.push({ error, code }),
      }),
    ).toBe(1)
    expect(errors[0]?.code).toBe("DETAIL_FAILED")
  })
})
