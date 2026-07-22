import { describe, test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiGet, getCredentials } from "../src/helpers";
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
    const payload = { results: [], count: 0 };

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
      retryDelayMs: 0,
    });

    expect(result).toEqual(payload);
    expect(calls).toBe(2);
    expect(delays).toEqual([0]);
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
    ).rejects.toThrow("Adzuna API request failed: 503 Service Unavailable");
    expect(calls).toBe(2);
  });

  test("returns a clear error for a final non-OK response", async () => {
    await expect(
      apiGet("https://example.test/jobs", {
        fetchFn: async () => jsonResponse(400, { error: "bad request" }, "Bad Request"),
      }),
    ).rejects.toThrow("Adzuna API request failed: 400 Bad Request");
  });
});

describe("search URL", () => {
  test("encodes query and location and includes country, page, and limit", () => {
    const url = buildUrl(
      {
        query: "responsabile it & AI",
        where: "Bologna, Emilia-Romagna",
        country: "es",
        page: 3,
        limit: 50,
        format: "json",
      },
      { appId: "app id", appKey: "key&value" },
    );
    const parsed = new URL(url);

    expect(parsed.pathname).toBe("/v1/api/jobs/es/search/3");
    expect(parsed.searchParams.get("what")).toBe("responsabile it & AI");
    expect(parsed.searchParams.get("where")).toBe("Bologna, Emilia-Romagna");
    expect(parsed.searchParams.get("results_per_page")).toBe("50");
    expect(parsed.search).toContain("what=responsabile+it+%26+AI");
    expect(parsed.search).toContain("where=Bologna%2C+Emilia-Romagna");
  });
});

describe("credentials", () => {
  test("missing credentials returns NO_CREDENTIALS and exit 2 without touching the real .env", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "adzuna-empty-repo-"));
    const errors: Array<{ error: string; code: string }> = [];

    const exitCode = await runSearch(
      { country: "it", page: 1, limit: 1, format: "json" },
      {
        repoRoot,
        environment: {},
        writeError: (error, code) => errors.push({ error, code }),
      },
    );

    expect(exitCode).toBe(2);
    expect(errors).toEqual([
      {
        error: expect.stringContaining("missing Adzuna credentials"),
        code: "NO_CREDENTIALS",
      },
    ]);
    expect(getCredentials(repoRoot, {})).toBeNull();
  });
});
