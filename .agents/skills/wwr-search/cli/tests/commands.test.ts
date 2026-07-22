import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { apiGet, DEFAULT_CATEGORIES, HIMALAYAS_API_BASE } from "../src/helpers"
import {
  buildHimalayasUrl,
  buildWwrUrl,
  parseCategories,
  runSearch,
  type SearchOpts,
} from "../src/commands/search"

const wwrFixture = readFileSync(join(import.meta.dir, "fixtures", "wwr-edge-cases.rss"), "utf8")
const himalayasFixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "himalayas.json"), "utf8"),
) as unknown
const managerRss = `<?xml version="1.0"?><rss><channel><item><title>Acme: Engineering Manager</title><description>Manage a remote team.</description><pubDate>Tue, 22 Jul 2026 10:00:00 +0000</pubDate><link>https://example.test/jobs/engineering-manager</link></item></channel></rss>`

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  })
}

function rssResponse(body = wwrFixture): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/rss+xml" } })
}

function opts(overrides: Partial<SearchOpts> = {}): SearchOpts {
  return {
    query: undefined,
    source: "both",
    categories: [...DEFAULT_CATEGORIES],
    limit: 50,
    format: "json",
    ...overrides,
  }
}

async function runWithFetch(
  searchOpts: SearchOpts,
  fetchFn: typeof fetch,
): Promise<{ exitCode: number; output: Record<string, unknown>; stdout: string; errors: Array<{ error: string; code: string }> }> {
  let stdout = ""
  const originalWrite = process.stdout.write
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
    return true
  }) as typeof process.stdout.write
  const errors: Array<{ error: string; code: string }> = []

  try {
    const exitCode = await runSearch(searchOpts, { fetchFn, writeError: (error, code) => errors.push({ error, code }) })
    return { exitCode, output: (stdout.startsWith("{") ? JSON.parse(stdout) : {}) as Record<string, unknown>, stdout, errors }
  } finally {
    process.stdout.write = originalWrite
  }
}

describe("source URLs and category parsing", () => {
  test("uses the verified WWR RSS path and Himalayas JSON pagination", () => {
    expect(buildWwrUrl("remote-programming-jobs")).toBe(
      "https://weworkremotely.com/categories/remote-programming-jobs.rss",
    )
    const parsed = new URL(buildHimalayasUrl(20, 0))
    expect(parsed.origin + parsed.pathname).toBe(HIMALAYAS_API_BASE)
    expect(parsed.searchParams.get("limit")).toBe("20")
    expect(parsed.searchParams.get("offset")).toBe("0")
  })

  test("accepts repeated and comma-separated categories without inventing values", () => {
    expect(parseCategories(["remote-programming-jobs,remote-product-jobs", "remote-management-and-finance-jobs"])).toEqual([
      "remote-programming-jobs",
      "remote-product-jobs",
      "remote-management-and-finance-jobs",
    ])
  })
})

describe("source selection and merge", () => {
  test("source wwr does not request Himalayas", async () => {
    const calls: string[] = []
    const result = await runWithFetch(opts({ source: "wwr", categories: ["remote-programming-jobs"] }), async (input) => {
      calls.push(String(input))
      return rssResponse()
    })

    expect(result.exitCode).toBe(0)
    expect(calls).toEqual([buildWwrUrl("remote-programming-jobs")])
    expect((result.output.meta as { sources: string[] }).sources).toEqual(["wwr"])
    expect((result.output.results as Array<{ portal: string }>).every((row) => row.portal === "wwr")).toBe(true)
  })

  test("source himalayas maps JSON and does not request WWR", async () => {
    const calls: string[] = []
    const result = await runWithFetch(opts({ source: "himalayas" }), async (input) => {
      calls.push(String(input))
      return jsonResponse(200, himalayasFixture)
    })

    expect(result.exitCode).toBe(0)
    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every((url) => url.startsWith(HIMALAYAS_API_BASE))).toBe(true)
    expect((result.output.meta as { sources: string[] }).sources).toEqual(["himalayas"])
    expect((result.output.results as Array<{ portal: string }>).every((row) => row.portal === "himalayas")).toBe(true)
  })

  test("both merges sources and applies query and limit after the merge", async () => {
    const result = await runWithFetch(
      opts({ source: "both", categories: ["remote-programming-jobs"], query: "manager", limit: 2 }),
      async (input) => (String(input).startsWith("https://himalayas.app") ? jsonResponse(200, himalayasFixture) : rssResponse(managerRss)),
    )

    expect(result.exitCode).toBe(0)
    expect((result.output.meta as { sources: string[] }).sources).toEqual(["wwr", "himalayas"])
    expect((result.output.results as Array<{ portal: string }>).length).toBe(2)
    expect((result.output.results as Array<{ portal: string }>).map((row) => row.portal)).toEqual([
      "wwr",
      "himalayas",
    ])
  })

  test("renders table and plain summaries with per-source attribution", async () => {
    const table = await runWithFetch(
      opts({ source: "wwr", categories: ["remote-programming-jobs"], format: "table", limit: 1 }),
      async () => rssResponse(),
    )
    expect(table.exitCode).toBe(0)
    expect(table.stdout).toContain("PORTAL")
    expect(table.stdout).toContain("wwr")
    expect(table.stdout).toContain("Sources: We Work Remotely")

    const plain = await runWithFetch(
      opts({ source: "wwr", categories: ["remote-programming-jobs"], format: "plain", limit: 1 }),
      async () => rssResponse(),
    )
    expect(plain.exitCode).toBe(0)
    expect(plain.stdout).toContain("portal: wwr")
    expect(plain.stdout).toContain("https://example.test/jobs/ai-consultant")
  })

  test("whole-token AND query does not match care inside Healthcare", async () => {
    const result = await runWithFetch(
      opts({ source: "wwr", categories: ["remote-programming-jobs"], query: "care", limit: 50 }),
      async () => rssResponse(),
    )

    expect(result.exitCode).toBe(0)
    expect((result.output.results as Array<{ title: string }>).map((row) => row.title)).not.toContain("No Company Role & Design")
    expect((result.output.results as Array<{ title: string }>).map((row) => row.title)).toContain("AI Consultant")
  })
})

describe("retry and source failures", () => {
  test("retries one transient response", async () => {
    let calls = 0
    const delays: number[] = []
    const payload = { jobs: [] }
    const result = await apiGet<typeof payload>("https://example.test/jobs", {
      fetchFn: async () => {
        calls++
        return calls === 1 ? new Response(null, { status: 503, statusText: "Service Unavailable" }) : jsonResponse(200, payload)
      },
      sleepFn: async (ms) => delays.push(ms),
    })

    expect(result).toEqual(payload)
    expect(calls).toBe(2)
    expect(delays).toEqual([1000])
  })

  test("explicit Himalayas failure is SOURCE_UNAVAILABLE", async () => {
    const result = await runWithFetch(opts({ source: "himalayas" }), async () => {
      throw new Error("network down")
    })

    expect(result.exitCode).toBe(1)
    expect(result.errors[0]?.code).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.error).toContain("Himalayas")
  })

  test("rejects malformed WWR responses with a structured source error", async () => {
    const result = await runWithFetch(opts({ source: "wwr" }), async () => new Response("<html>not RSS</html>", { status: 200 }))

    expect(result.exitCode).toBe(1)
    expect(result.errors[0]?.code).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.error).toContain("invalid response body")
  })

  test("both continues with WWR when Himalayas is unavailable", async () => {
    const result = await runWithFetch(opts({ source: "both", categories: ["remote-programming-jobs"] }), async (input) => {
      if (String(input).startsWith("https://himalayas.app")) throw new Error("Himalayas unavailable")
      return rssResponse()
    })

    expect(result.exitCode).toBe(0)
    expect(result.errors).toEqual([])
    expect((result.output.meta as { sources: string[] }).sources).toEqual(["wwr"])
  })
})
