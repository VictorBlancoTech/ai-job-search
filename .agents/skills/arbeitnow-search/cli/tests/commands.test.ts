import { describe, expect, test } from "bun:test"
import { apiGet } from "../src/helpers"
import { buildUrl, runSearch, type SearchOpts } from "../src/commands/search"
import type { SearchResponse } from "../src/helpers"

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  })
}

const filteringFixture: SearchResponse = {
  data: [
    {
      slug: "healthcare",
      url: "https://example.test/healthcare",
      title: "Healthcare Analyst",
      company_name: "Health Data",
      tags: ["Analytics"],
      location: "Berlin",
      remote: false,
      description: "Healthcare analytics and reporting.",
      created_at: 1760000000,
    },
    {
      slug: "health-care",
      url: "https://example.test/health-care",
      title: "Health Care Coordinator",
      company_name: "Care Network",
      tags: ["Operations"],
      location: "Munich",
      remote: true,
      description: "Coordinate health and care services.",
      created_at: 1760000001,
    },
    {
      slug: "tag-match",
      url: "https://example.test/tag-match",
      title: "Platform Engineer",
      company_name: "Acme Systems",
      tags: ["AI", "Consultant"],
      location: "Hamburg",
      remote: true,
      description: "Build reliable infrastructure.",
      created_at: 1760000002,
    },
    {
      slug: "description-match",
      url: "https://example.test/description-match",
      title: "Platform Engineer",
      company_name: "Acme Systems",
      tags: ["Engineering"],
      location: "Cologne",
      remote: false,
      description: "Consultant for AI delivery programs.",
      created_at: 1760000003,
    },
  ],
}

type SearchOutput = {
  meta: { portal: string; count: number; query: string | null; location: string | null }
  results: Array<{ id: string; remote: boolean | null }>
}

async function runFixtureSearch(
  opts: SearchOpts,
  response: SearchResponse = filteringFixture,
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

describe("apiGet", () => {
  test("retries one 503 and succeeds without waiting in the unit test", async () => {
    let calls = 0
    const delays: number[] = []
    const payload = { data: [], links: {}, meta: {} }

    const result = await apiGet<typeof payload>("https://example.test/jobs", {
      fetchFn: async () => {
        calls++
        return calls === 1
          ? new Response(null, { status: 503, statusText: "Service Unavailable" })
          : jsonResponse(200, payload)
      },
      sleepFn: async (ms) => {
        delays.push(ms)
      },
    })

    expect(result).toEqual(payload)
    expect(calls).toBe(2)
    expect(delays).toEqual([2000])
  })

  test("fails clearly after the final transient response", async () => {
    let calls = 0

    await expect(
      apiGet("https://example.test/jobs", {
        fetchFn: async () => {
          calls++
          return new Response(null, { status: 503, statusText: "Service Unavailable" })
        },
        sleepFn: async () => {},
        retryDelayMs: 0,
      }),
    ).rejects.toThrow("Arbeitnow API request failed: 503 Service Unavailable")
    expect(calls).toBe(2)
  })
})

describe("search URL", () => {
  test("encodes the optional server hint and page safely", () => {
    const url = buildUrl({
      query: "AI consultant & remote",
      remoteOnly: false,
      page: 2,
      limit: 5,
      format: "json",
    })
    const parsed = new URL(url)

    expect(parsed.pathname).toBe("/api/job-board-api")
    expect(parsed.searchParams.get("search")).toBe("AI consultant & remote")
    expect(parsed.searchParams.get("page")).toBe("2")
    expect(parsed.search).toContain("search=AI+consultant+%26+remote")
  })

  test("always sends page and does not turn local limit into API pagination", () => {
    const parsed = new URL(
      buildUrl({ query: undefined, remoteOnly: true, page: 1, limit: 1, format: "json" }),
    )

    expect(parsed.searchParams.get("page")).toBe("1")
    expect(parsed.searchParams.has("limit")).toBe(false)
  })
})

describe("runSearch local filtering", () => {
  test("matches complete query tokens across title, company, tags, description, and location", async () => {
    const care = await runFixtureSearch({ query: "care", remoteOnly: false, page: 1, limit: 100, format: "json" })
    expect(care.output.results.map(({ id }) => id)).toEqual(["health-care"])

    const tagQuery = await runFixtureSearch({
      query: "AI consultant",
      remoteOnly: false,
      page: 1,
      limit: 100,
      format: "json",
    })
    expect(tagQuery.output.results.map(({ id }) => id)).toEqual(["tag-match", "description-match"])

    const locationQuery = await runFixtureSearch({
      query: "Munich",
      remoteOnly: false,
      page: 1,
      limit: 100,
      format: "json",
    })
    expect(locationQuery.output.results.map(({ id }) => id)).toEqual(["health-care"])
  })

  test("filters remote-only using remote === true", async () => {
    const result = await runFixtureSearch({
      query: undefined,
      remoteOnly: true,
      page: 1,
      limit: 100,
      format: "json",
    })

    expect(result.output.results.map(({ id, remote }) => [id, remote])).toEqual([
      ["health-care", true],
      ["tag-match", true],
    ])
  })

  test("applies the limit after local filters", async () => {
    const result = await runFixtureSearch({
      query: "platform",
      remoteOnly: false,
      page: 1,
      limit: 1,
      format: "json",
    })

    expect(result.exitCode).toBe(0)
    expect(result.output.meta.count).toBe(1)
    expect(result.output.results.map(({ id }) => id)).toEqual(["tag-match"])
  })

  test("returns an empty result for no matches", async () => {
    const result = await runFixtureSearch({
      query: "quantum astronaut",
      remoteOnly: false,
      page: 1,
      limit: 100,
      format: "json",
    })

    expect(result.exitCode).toBe(0)
    expect(result.output.meta.count).toBe(0)
    expect(result.output.results).toEqual([])
  })

  test("renders human-readable table and plain summaries", async () => {
    let output = ""
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
      return true
    }) as typeof process.stdout.write

    try {
      const tableExit = await runSearch(
        { query: "care", remoteOnly: false, page: 1, limit: 5, format: "table" },
        { apiGet: async () => filteringFixture },
      )
      expect(tableExit).toBe(0)
      expect(output).toContain("Health Care Coordinator")

      output = ""
      const plainExit = await runSearch(
        { query: "care", remoteOnly: false, page: 1, limit: 5, format: "plain" },
        { apiGet: async () => filteringFixture },
      )
      expect(plainExit).toBe(0)
      expect(output).toContain("https://example.test/health-care")
    } finally {
      process.stdout.write = originalWrite
    }
  })
})

describe("runSearch failures", () => {
  test("returns exit 1 and writes a structured error when fetch fails", async () => {
    const errors: Array<{ error: string; code: string }> = []
    const exitCode = await runSearch(
      { query: undefined, remoteOnly: false, page: 1, limit: 1, format: "json" },
      {
        fetchFn: async () => {
          throw new Error("upstream unavailable")
        },
        writeError: (error, code) => errors.push({ error, code }),
      },
    )

    expect(exitCode).toBe(1)
    expect(errors).toEqual([
      { error: "could not reach the Arbeitnow API (upstream unavailable)", code: "SEARCH_FAILED" },
    ])
  })

  test("returns exit 1 for a malformed API envelope", async () => {
    const errors: Array<{ error: string; code: string }> = []
    const exitCode = await runSearch(
      { query: undefined, remoteOnly: false, page: 1, limit: 1, format: "json" },
      {
        apiGet: async () => ({ data: "not an array" }),
        writeError: (error, code) => errors.push({ error, code }),
      },
    )

    expect(exitCode).toBe(1)
    expect(errors[0]?.code).toBe("SEARCH_FAILED")
    expect(errors[0]?.error).toContain("invalid response body")
  })
})
