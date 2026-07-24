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
    const payload = { type: "jobs", hits: 0, pages: 0, jobs: [] };

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
    ).rejects.toThrow("Careerjet API request failed: 503 Service Unavailable");
    expect(calls).toBe(2);
  });

  test("returns a clear error for a final non-OK response", async () => {
    await expect(
      apiGet("https://example.test/jobs", {
        fetchFn: async () => jsonResponse(400, { error: "bad request" }, "Bad Request"),
      }),
    ).rejects.toThrow("Careerjet API request failed: 400 Bad Request");
  });
});

describe("search URL", () => {
  test("encodes keywords and location and includes locale, page, and pagesize", () => {
    const url = buildUrl({
      query: "responsabile it & AI",
      where: "Bologna, Emilia-Romagna",
      country: "es",
      page: 3,
      limit: 50,
      format: "json",
    });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe("https://public.api.careerjet.net/search");
    expect(parsed.searchParams.get("locale_code")).toBe("es_ES");
    expect(parsed.searchParams.get("keywords")).toBe("responsabile it & AI");
    expect(parsed.searchParams.get("location")).toBe("Bologna, Emilia-Romagna");
    expect(parsed.searchParams.get("page")).toBe("3");
    expect(parsed.searchParams.get("pagesize")).toBe("50");
    expect(parsed.searchParams.get("sort")).toBe("relevance");
  });

  test("maps it → it_IT and es → es_ES", () => {
    const it = new URL(buildUrl({ country: "it", page: 1, limit: 1, format: "json" }));
    const es = new URL(buildUrl({ country: "es", page: 1, limit: 1, format: "json" }));
    expect(it.searchParams.get("locale_code")).toBe("it_IT");
    expect(es.searchParams.get("locale_code")).toBe("es_ES");
  });

  test("clamps pagesize to the API maximum of 99", () => {
    const url = new URL(buildUrl({ country: "it", page: 1, limit: 500, format: "json" }));
    expect(url.searchParams.get("pagesize")).toBe("99");
  });

  test("omits keywords/location when not provided", () => {
    const url = new URL(buildUrl({ country: "it", page: 1, limit: 25, format: "json" }));
    expect(url.searchParams.has("keywords")).toBe(false);
    expect(url.searchParams.has("location")).toBe(false);
  });
});

describe("runSearch failure handling", () => {
  test("returns 1 and writes SEARCH_FAILED when the API rejects", async () => {
    let stderr = "";
    const exitCode = await runSearch(
      { country: "it", page: 1, limit: 1, format: "json" },
      {
        apiGet: async () => {
          throw new Error("upstream unavailable");
        },
        writeError: (error, code) => {
          stderr += JSON.stringify({ error, code }) + "\n";
        },
      },
    );

    expect(exitCode).toBe(1);
    expect(JSON.parse(stderr)).toEqual({ error: "upstream unavailable", code: "SEARCH_FAILED" });
  });

  test("succeeds without credentials (Careerjet public API is keyless)", async () => {
    let stdout = "";
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    try {
      const exitCode = await runSearch(
        { country: "it", page: 1, limit: 1, format: "json" },
        {
          apiGet: async () => ({ type: "jobs", hits: 0, pages: 0, jobs: [] }),
        },
      );
      expect(exitCode).toBe(0);
      const parsed = JSON.parse(stdout) as { meta: { portal: string; count: number }; results: unknown[] };
      expect(parsed.meta.portal).toBe("careerjet");
      expect(parsed.meta.count).toBe(0);
      expect(parsed.results).toEqual([]);
    } finally {
      process.stdout.write = originalWrite;
    }
  });
});
