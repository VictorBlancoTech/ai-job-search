import { describe, test, expect } from "bun:test";
import { apiGet } from "../src/helpers";
import { buildUrl, runSearch } from "../src/commands/search";

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
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
