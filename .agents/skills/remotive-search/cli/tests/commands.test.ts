import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { apiGet } from "../src/helpers";
import { buildUrl, runSearch, type SearchOpts } from "../src/commands/search";
import type { SearchResponse } from "../src/helpers";

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search.json"), "utf8"),
) as SearchResponse;

const filteringFixture: SearchResponse = {
  jobs: [
    {
      id: "healthcare",
      url: "https://example.test/healthcare",
      title: "Healthcare Analyst",
      company_name: "Health Data",
      category: "Medical",
      candidate_required_location: "Worldwide",
      description: "Healthcare analytics and reporting.",
    },
    {
      id: "health-care",
      url: "https://example.test/health-care",
      title: "Health Care Coordinator",
      company_name: "Care Network",
      category: "Medical",
      candidate_required_location: "Worldwide",
      description: "<p>Coordinate health and care services.</p>",
    },
    {
      id: "health-only",
      url: "https://example.test/health-only",
      title: "Health Services Analyst",
      company_name: "Public Health",
      category: "Medical",
      candidate_required_location: "Worldwide",
      description: "Health services analysis.",
    },
    {
      id: "medical-exact",
      url: "https://example.test/medical",
      title: "Clinical Specialist",
      company_name: "Clinical Labs",
      category: "Medical",
      candidate_required_location: "Worldwide",
      description: "Clinical operations support.",
    },
    {
      id: "medical-operations",
      url: "https://example.test/medical-operations",
      title: "Operations Manager",
      company_name: "Hospital Group",
      category: "Medical Operations",
      candidate_required_location: "Worldwide",
      description: "Manage operational programs.",
    },
    {
      id: "accented",
      url: "https://example.test/accented",
      title: "Atencion al Cliente",
      company_name: "Servicio Publico",
      category: "Customer Service",
      candidate_required_location: "Worldwide",
      description: "Support customers.",
    },
  ],
};

type SearchOutput = {
  meta: { count: number };
  results: Array<{ id: string }>;
};

async function runFixtureSearch(
  opts: SearchOpts,
  response: SearchResponse = fixture,
): Promise<{ exitCode: number; output: SearchOutput }> {
  let stdout = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    const exitCode = await runSearch(opts, { apiGet: async () => response });
    return { exitCode, output: JSON.parse(stdout) as SearchOutput };
  } finally {
    process.stdout.write = originalWrite;
  }
}

describe("apiGet", () => {
  test("retries one 503 and succeeds without waiting in the unit test", async () => {
    let calls = 0;
    const delays: number[] = [];
    const payload = { jobs: [], "job-count": 0 };

    const result = await apiGet<typeof payload>("https://example.test/jobs", {
      fetchFn: async () => {
        calls++;
        return calls === 1
          ? new Response(null, { status: 503, statusText: "Service Unavailable" })
          : jsonResponse(200, payload);
      },
      sleepFn: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toEqual(payload);
    expect(calls).toBe(2);
    expect(delays).toEqual([2000]);
  });

  test("returns a clear error after the final 5xx", async () => {
    let calls = 0;

    await expect(
      apiGet("https://example.test/jobs", {
        fetchFn: async () => {
          calls++;
          return new Response(null, { status: 503, statusText: "Service Unavailable" });
        },
        sleepFn: async () => {},
        retryDelayMs: 0,
      }),
    ).rejects.toThrow("Remotive API request failed: 503 Service Unavailable");
    expect(calls).toBe(2);
  });
});

describe("search URL", () => {
  test("encodes query and category and includes the limit", () => {
    const url = buildUrl({
      query: "AI consultant & remote",
      category: "Software Development",
      limit: 100,
      format: "json",
    });
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/api/remote-jobs");
    expect(parsed.searchParams.get("search")).toBe("AI consultant & remote");
    expect(parsed.searchParams.get("category")).toBe("Software Development");
    expect(parsed.searchParams.get("limit")).toBe("100");
    expect(parsed.search).toContain("search=AI+consultant+%26+remote");
    expect(parsed.search).toContain("category=Software+Development");
  });
});

describe("runSearch failure handling", () => {
  test("matches whole query tokens instead of substrings", async () => {
    const care = await runFixtureSearch(
      { query: "care", limit: 100, format: "json" },
      filteringFixture,
    );
    expect(care.output.results.map(({ id }) => id)).toEqual(["health-care"]);

    const healthCare = await runFixtureSearch(
      { query: "health care", limit: 100, format: "json" },
      filteringFixture,
    );
    expect(healthCare.output.results.map(({ id }) => id)).toEqual(["health-care"]);
  });

  test("matches query text without diacritics", async () => {
    const result = await runFixtureSearch(
      { query: "atención", limit: 100, format: "json" },
      filteringFixture,
    );

    expect(result.output.results.map(({ id }) => id)).toEqual(["accented"]);
  });

  test("requires exact normalized category equality", async () => {
    const result = await runFixtureSearch(
      { category: "medical", limit: 100, format: "json" },
      filteringFixture,
    );

    expect(result.output.results.map(({ id }) => id)).toEqual([
      "healthcare",
      "health-care",
      "health-only",
      "medical-exact",
    ]);
  });

  test("matches query tokens across title, company, description, category, and location", async () => {
    const cases = [
      { query: "patient care", ids: ["2091069"] },
      { query: "STATLINX remote call", ids: ["2091069"] },
      { query: "software development", ids: ["1919265", "1919266"] },
      { query: "Americas Israel", ids: ["1919265", "1919266"] },
      { query: "production AI systems", ids: ["1919266"] },
    ];

    for (const { query, ids } of cases) {
      const result = await runFixtureSearch({ query, limit: 100, format: "json" });
      expect(result.exitCode).toBe(0);
      expect(result.output.results.map(({ id }) => id)).toEqual(ids);
    }
  });

  test("filters category before applying the limit", async () => {
    const result = await runFixtureSearch({
      query: "senior independent",
      category: "software development",
      limit: 1,
      format: "json",
    });

    expect(result.exitCode).toBe(0);
    expect(result.output.meta.count).toBe(1);
    expect(result.output.results.map(({ id }) => id)).toEqual(["1919265"]);

    const categoryOnly = await runFixtureSearch({
      category: "software development",
      limit: 100,
      format: "json",
    });
    expect(categoryOnly.output.results.map(({ id }) => id)).toEqual(["1919265", "1919266"]);
  });

  test("returns no results when the local filters do not match", async () => {
    const result = await runFixtureSearch({
      query: "quantum astronaut",
      category: "Software Development",
      limit: 100,
      format: "json",
    });

    expect(result.exitCode).toBe(0);
    expect(result.output.meta.count).toBe(0);
    expect(result.output.results).toEqual([]);
  });

  test("caps results locally when the API returns more than requested", async () => {
    let stdout = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const exitCode = await runSearch(
        { limit: 1, format: "json" },
        {
          apiGet: async () => ({
            jobs: [
              { id: 1, url: "https://example.test/1", title: "First" },
              { id: 2, url: "https://example.test/2", title: "Second" },
            ],
          }),
        },
      );

      expect(exitCode).toBe(0);
      const payload = JSON.parse(stdout) as { meta: { count: number }; results: unknown[] };
      expect(payload.meta.count).toBe(1);
      expect(payload.results).toHaveLength(1);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("returns 1 and writes SEARCH_FAILED when the injected fetch fails", async () => {
    const errors: Array<{ error: string; code: string }> = [];
    const exitCode = await runSearch(
      { limit: 1, format: "json" },
      {
        fetchFn: async () => {
          throw new Error("upstream unavailable");
        },
        writeError: (error, code) => errors.push({ error, code }),
      },
    );

    expect(exitCode).toBe(1);
    expect(errors).toEqual([
      { error: "could not reach the Remotive API (upstream unavailable)", code: "SEARCH_FAILED" },
    ]);
  });
});
