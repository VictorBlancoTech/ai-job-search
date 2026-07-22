import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  API_BASE,
  REMOTEOK_USER_AGENT,
  apiGet,
} from "../src/helpers"
import { buildUrl, runSearch, type SearchOpts } from "../src/commands/search"

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search.json"), "utf8"),
) as unknown[]

type SearchOutput = {
  meta: {
    portal: string
    count: number
    query: string | null
    location: string | null
  }
  results: Array<{ id: string; portal: string }>
}

async function captureSearch(
  opts: SearchOpts,
  response: unknown = fixture,
): Promise<{ exitCode: number; output: SearchOutput }> {
  let stdout = ""
  const originalWrite = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stdout.write

  try {
    const exitCode = await runSearch(opts, { apiGet: async () => response })
    return { exitCode, output: JSON.parse(stdout) as SearchOutput }
  } finally {
    process.stdout.write = originalWrite
  }
}

function captureSummary(opts: SearchOpts): Promise<{ exitCode: number; output: string }> {
  let stdout = ""
  const originalWrite = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stdout.write

  return runSearch(opts, { apiGet: async () => fixture }).then(
    (exitCode) => {
      process.stdout.write = originalWrite
      return { exitCode, output: stdout }
    },
    (error) => {
      process.stdout.write = originalWrite
      throw error
    },
  )
}

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  })
}

describe("RemoteOK response and request handling", () => {
  test("skips legal metadata and malformed/non-object entries", async () => {
    const result = await captureSearch({ limit: 100, format: "json" })

    expect(result.exitCode).toBe(0)
    expect(result.output.meta).toEqual({
      portal: "remoteok",
      count: 5,
      query: null,
      location: null,
    })
    expect(result.output.results.map(({ id }) => id)).toEqual([
      "1135014",
      "9001",
      "9002",
      "9003",
      "9004",
    ])
    expect(result.output.results.every(({ portal }) => portal === "remoteok")).toBe(true)
  })

  test("does not send unreliable query or tag filters to the API URL", () => {
    expect(buildUrl({ query: "AI automation", tag: "care", limit: 5, format: "json" })).toBe(API_BASE)
  })

  test("matches query terms as normalized whole tokens with AND semantics", async () => {
    const care = await captureSearch({ query: "care", limit: 100, format: "json" })
    expect(care.output.results.map(({ id }) => id)).toEqual(["9002"])

    const acrossFields = await captureSearch({ query: "AI automation", limit: 100, format: "json" })
    expect(acrossFields.output.results.map(({ id }) => id)).toEqual(["9002"])

    const noMatch = await captureSearch({ query: "quantum astronaut", limit: 100, format: "json" })
    expect(noMatch.output.meta.count).toBe(0)
    expect(noMatch.output.results).toEqual([])
  })

  test("matches tags by exact normalized value rather than substring", async () => {
    const exact = await captureSearch({ tag: "HEALTHCARE", limit: 100, format: "json" })
    expect(exact.output.results.map(({ id }) => id)).toEqual(["9001", "9003"])

    const substring = await captureSearch({ tag: "health", limit: 100, format: "json" })
    expect(substring.output.results).toEqual([])
  })

  test("applies the limit after local filtering", async () => {
    const result = await captureSearch({ tag: "automation", limit: 1, format: "json" })

    expect(result.output.meta.count).toBe(1)
    expect(result.output.results.map(({ id }) => id)).toEqual(["9001"])
  })

  test("an empty query returns all valid jobs", async () => {
    const result = await captureSearch({ query: "   ", limit: 100, format: "json" })

    expect(result.output.meta.count).toBe(5)
  })

  test("sets the identifying User-Agent when fetching the public API", async () => {
    let seenUrl = ""
    let seenHeaders: HeadersInit | undefined
    const body = await apiGet<unknown>(API_BASE, {
      fetchFn: async (input, init) => {
        seenUrl = String(input)
        seenHeaders = init?.headers
        return jsonResponse(200, fixture)
      },
    })

    expect(body).toEqual(fixture)
    expect(seenUrl).toBe(API_BASE)
    const headers = new Headers(seenHeaders)
    expect(headers.get("user-agent")).toBe(REMOTEOK_USER_AGENT)
    expect(headers.get("accept")).toBe("application/json")
  })

  test("reports a clear error for a non-OK API response", async () => {
    await expect(
      apiGet(API_BASE, {
        fetchFn: async () => jsonResponse(403, { error: "forbidden" }, "Forbidden"),
      }),
    ).rejects.toThrow("RemoteOK API request failed: 403 Forbidden")
  })

  test("returns exit 1 and JSON error when the API fails", async () => {
    const errors: Array<{ error: string; code: string }> = []
    const exitCode = await runSearch(
      { limit: 1, format: "json" },
      {
        fetchFn: async () => jsonResponse(400, { error: "bad request" }, "Bad Request"),
        writeError: (error, code) => errors.push({ error, code }),
      },
    )

    expect(exitCode).toBe(1)
    expect(errors).toEqual([
      { error: "RemoteOK API request failed: 400 Bad Request", code: "SEARCH_FAILED" },
    ])
  })

  test("returns an empty result for a valid array containing no jobs", async () => {
    const result = await captureSearch({ limit: 1, format: "json" }, [{ legal: "terms" }, null, "bad"])

    expect(result.output.meta.count).toBe(0)
    expect(result.output.results).toEqual([])
  })
})

describe("summary formats", () => {
  test("table output identifies the portal and includes the attribution link", async () => {
    const result = await captureSummary({ limit: 1, format: "table" })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("portal: remoteok")
    expect(result.output).toContain("Remote OK")
    expect(result.output).toContain("https://remoteok.com/remote-jobs")
  })

  test("plain output is a portal-attributed summary", async () => {
    const result = await captureSummary({ limit: 1, format: "plain" })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain("portal: remoteok")
    expect(result.output).toContain("Source: Remote OK")
  })
})
