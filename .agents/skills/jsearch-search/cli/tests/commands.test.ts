import { describe, test, expect } from "bun:test";
import { apiGet, type ApiGetOptions } from "../src/helpers";
import { buildUrl, composeQuery, checkQuotaHeaders, runSearch, type SearchOpts } from "../src/commands/search";

function jsonResponse(status: number, body: unknown, statusText = ""): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "content-type": "application/json" },
  });
}

const OPTS: SearchOpts = { country: "it", page: 1, limit: 10, remote: false, format: "json" };

describe("apiGet", () => {
  test("retries one 503 and succeeds without waiting in the unit test", async () => {
    let calls = 0;
    const delays: number[] = [];
    const payload = { status: "OK", data: [] };

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
    ).rejects.toThrow("JSearch API request failed: 503 Service Unavailable");
    expect(calls).toBe(2);
  });

  test("returns a clear error for a final non-OK response", async () => {
    await expect(
      apiGet("https://example.test/jobs", {
        fetchFn: async () => jsonResponse(400, { error: "bad request" }, "Bad Request"),
      }),
    ).rejects.toThrow("JSearch API request failed: 400 Bad Request");
  });

  test("sends the X-API-Key header when an apiKey is provided", async () => {
    let seen: Record<string, string> = {};
    await apiGet("https://example.test/jobs", {
      apiKey: "test-key-123",
      fetchFn: async (_url, init) => {
        seen = Object.fromEntries(new Headers(init?.headers).entries());
        return jsonResponse(200, { status: "OK", data: [] });
      },
    });
    expect(seen["x-api-key"]).toBe("test-key-123");
  });

  test("omits the X-API-Key header when no apiKey is provided", async () => {
    let seen: Record<string, string> = {};
    await apiGet("https://example.test/jobs", {
      fetchFn: async (_url, init) => {
        seen = Object.fromEntries(new Headers(init?.headers).entries());
        return jsonResponse(200, { status: "OK", data: [] });
      },
    });
    expect(seen["x-api-key"]).toBeUndefined();
  });

  test("invokes onHeaders with the response headers", async () => {
    const seen: Headers[] = [];
    await apiGet("https://example.test/jobs", {
      onHeaders: (h) => seen.push(h),
      fetchFn: async () =>
        new Response(JSON.stringify({ status: "OK", data: [] }), {
          status: 200,
          headers: { "content-type": "application/json", "x-ratelimit-remaining": "42" },
        }),
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].get("x-ratelimit-remaining")).toBe("42");
  });
});

describe("composeQuery — fold the location into the free-text query", () => {
  test("query and location become 'kw in loc'", () => {
    expect(composeQuery({ ...OPTS, query: "IT Manager", where: "Bologna" })).toBe("IT Manager in Bologna");
  });

  test("query alone is unchanged", () => {
    expect(composeQuery({ ...OPTS, query: "AI consultant" })).toBe("AI consultant");
  });

  test("location alone still produces a query string", () => {
    expect(composeQuery({ ...OPTS, where: "Bologna" })).toBe("in Bologna");
  });
});

describe("search URL", () => {
  test("encodes the composed query and includes country, page, num_pages", () => {
    const url = buildUrl({ ...OPTS, query: "responsabile it & AI", where: "Bologna, Emilia-Romagna", country: "es", page: 3, limit: 10 });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe("https://api.openwebninja.com/jsearch/search");
    expect(parsed.searchParams.get("query")).toBe("responsabile it & AI in Bologna, Emilia-Romagna");
    expect(parsed.searchParams.get("country")).toBe("es");
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(parsed.searchParams.get("num_pages")).toBe("1");
  });

  test("remote=true adds remote_jobs_only=true; otherwise the flag is absent", () => {
    const remote = new URL(buildUrl({ ...OPTS, query: "q", remote: true }));
    const onsite = new URL(buildUrl({ ...OPTS, query: "q", remote: false }));
    expect(remote.searchParams.get("remote_jobs_only")).toBe("true");
    expect(onsite.searchParams.has("remote_jobs_only")).toBe(false);
  });

  test("limit above one API page (10) requests a second page", () => {
    expect(new URL(buildUrl({ ...OPTS, query: "q", limit: 10 })).searchParams.get("num_pages")).toBe("1");
    expect(new URL(buildUrl({ ...OPTS, query: "q", limit: 11 })).searchParams.get("num_pages")).toBe("2");
    expect(new URL(buildUrl({ ...OPTS, query: "q", limit: 20 })).searchParams.get("num_pages")).toBe("2");
  });
});

describe("checkQuotaHeaders — freemium quota warning", () => {
  test("warns when X-RateLimit-Remaining drops below 20", () => {
    const warnings: string[] = [];
    checkQuotaHeaders(new Headers({ "X-RateLimit-Remaining": "12" }), (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("12");
  });

  test("stays silent at or above 20 remaining", () => {
    const warnings: string[] = [];
    checkQuotaHeaders(new Headers({ "X-RateLimit-Remaining": "20" }), (m) => warnings.push(m));
    checkQuotaHeaders(new Headers({ "X-RateLimit-Remaining": "150" }), (m) => warnings.push(m));
    expect(warnings).toHaveLength(0);
  });

  test("stays silent when the header is absent or non-numeric", () => {
    const warnings: string[] = [];
    checkQuotaHeaders(new Headers(), (m) => warnings.push(m));
    checkQuotaHeaders(new Headers({ "X-RateLimit-Remaining": "n/a" }), (m) => warnings.push(m));
    expect(warnings).toHaveLength(0);
  });
});

describe("runSearch", () => {
  test("missing API key returns NO_CREDENTIALS and exit 2 without calling the API", async () => {
    let stderr = "";
    let apiCalled = false;
    const exitCode = await runSearch(OPTS, {
      repoRoot: import.meta.dir,
      environment: {},
      apiGet: async () => {
        apiCalled = true;
        return { status: "OK", data: [] };
      },
      writeError: (error, code) => {
        stderr += JSON.stringify({ error, code }) + "\n";
      },
    });

    expect(exitCode).toBe(2);
    expect(apiCalled).toBe(false);
    const parsed = JSON.parse(stderr) as { error: string; code: string };
    expect(parsed.code).toBe("NO_CREDENTIALS");
    expect(parsed.error).toContain("JSEARCH_API_KEY");
  });

  test("passes the resolved API key to the transport and emits the contract JSON", async () => {
    let stdout = "";
    let seenKey: string | undefined;
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const exitCode = await runSearch(
        { ...OPTS, query: "IT Manager", where: "Bologna" },
        {
          environment: { JSEARCH_API_KEY: "test-key-123" },
          apiGet: async (_url, options?: ApiGetOptions) => {
            seenKey = options?.apiKey;
            return { status: "OK", data: [] };
          },
        },
      );
      expect(exitCode).toBe(0);
      expect(seenKey).toBe("test-key-123");
      const parsed = JSON.parse(stdout) as { meta: { portal: string; count: number; query: string; location: string }; results: unknown[] };
      expect(parsed.meta.portal).toBe("jsearch");
      expect(parsed.meta.count).toBe(0);
      expect(parsed.meta.query).toBe("IT Manager");
      expect(parsed.meta.location).toBe("Bologna");
      expect(parsed.results).toEqual([]);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("surfaces the quota warning when the transport reports low remaining requests", async () => {
    const warnings: string[] = [];
    let stdout = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const exitCode = await runSearch(OPTS, {
        environment: { JSEARCH_API_KEY: "k" },
        writeWarning: (m) => warnings.push(m),
        apiGet: async (_url, options?: ApiGetOptions) => {
          options?.onHeaders?.(new Headers({ "X-RateLimit-Remaining": "7" }));
          return { status: "OK", data: [] };
        },
      });
      expect(exitCode).toBe(0);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("7");
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("slices results to the requested limit", async () => {
    let stdout = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    const job = { job_id: "x", job_title: "T" };
    try {
      const exitCode = await runSearch(
        { ...OPTS, limit: 2 },
        {
          environment: { JSEARCH_API_KEY: "k" },
          apiGet: async () => ({ status: "OK", data: [job, job, job] }),
        },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { meta: { count: number }; results: unknown[] };
      expect(parsed.meta.count).toBe(2);
      expect(parsed.results).toHaveLength(2);
    } finally {
      process.stdout.write = originalWrite;
    }
  });

  test("returns 1 and writes SEARCH_FAILED when the API rejects", async () => {
    let stderr = "";
    const exitCode = await runSearch(OPTS, {
      environment: { JSEARCH_API_KEY: "k" },
      apiGet: async () => {
        throw new Error("upstream unavailable");
      },
      writeError: (error, code) => {
        stderr += JSON.stringify({ error, code }) + "\n";
      },
    });

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr)).toEqual({ error: "upstream unavailable", code: "SEARCH_FAILED" });
  });
});
