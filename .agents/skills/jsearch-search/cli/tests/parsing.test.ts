import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildLocation,
  getApiKey,
  loadEnv,
  loadEnvFile,
  parseJsearchDate,
  stripHtml,
  toResult,
  type JSearchJob,
} from "../src/helpers";

// Real JSearch API response (country it, query "IT Manager in Bologna"),
// trimmed to 3 jobs and patched with documented fields the live query
// returned empty: [0] sparse (country only, no salary), [1] salary block,
// [2] full city/state/country location, remote=true.
const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search-it.json"), "utf8"),
) as { data: JSearchJob[] };

describe("toResult — reshape a JSearch job into the portal-skill contract", () => {
  test("maps the wire fields into the contract", () => {
    const job = fixture.data[0];
    const r = toResult(job);
    expect(r).toEqual({
      id: job.job_id!,
      portal: "jsearch",
      title: "It Manager.",
      company: "W Executive S.R.L.",
      location: "IT",
      url: "https://www.recruit.net/job/it-manager--jobs/FE8200BB732FFE3C",
      date: "2026-07-23",
      description: expect.any(String),
      remote: false,
      salary: null,
    });
  });

  test("id is the API's job_id passed through unchanged", () => {
    for (const job of fixture.data) {
      expect(toResult(job).id).toBe(job.job_id!);
    }
  });

  test("location joins city/state/country, skipping empty parts", () => {
    expect(toResult(fixture.data[2]).location).toBe("Bologna, Città Metropolitana di Bologna, IT");
    expect(toResult(fixture.data[0]).location).toBe("IT");
    expect(toResult(fixture.data[1]).location).toBeNull();
  });

  test("date is the ISO UTC timestamp cut to YYYY-MM-DD", () => {
    expect(toResult(fixture.data[0]).date).toBe("2026-07-23");
    expect(toResult(fixture.data[1]).date).toBe("2026-07-21");
    expect(toResult(fixture.data[2]).date).toBe("2026-07-18");
  });

  test("salary is \"min-max CUR\" when both bounds exist", () => {
    expect(toResult(fixture.data[1]).salary).toBe("40000-50000 EUR");
  });

  test("salary is null when a bound is missing", () => {
    const onlyMin: JSearchJob = { ...fixture.data[1], job_max_salary: undefined };
    const onlyMax: JSearchJob = { ...fixture.data[1], job_min_salary: undefined };
    expect(toResult(onlyMin).salary).toBeNull();
    expect(toResult(onlyMax).salary).toBeNull();
    expect(toResult(fixture.data[0]).salary).toBeNull();
    expect(toResult(fixture.data[2]).salary).toBeNull();
  });

  test("remote is job_is_remote passed through as a boolean", () => {
    expect(toResult(fixture.data[0]).remote).toBe(false);
    expect(toResult(fixture.data[2]).remote).toBe(true);
  });

  test("missing fields degrade to null or empty string", () => {
    const bare: JSearchJob = { job_id: "x1", job_title: "T" };
    const r = toResult(bare);
    expect(r.company).toBeNull();
    expect(r.location).toBeNull();
    expect(r.url).toBe("");
    expect(r.description).toBe("");
    expect(r.date).toBeNull();
    expect(r.remote).toBeNull();
    expect(r.salary).toBeNull();
  });

  test("description has HTML stripped", () => {
    const htmlJob: JSearchJob = {
      ...fixture.data[0],
      job_description: "<p>Ruolo <strong>chiave</strong> nel team.<br>Requisiti: 5 anni.</p>",
    };
    const r = toResult(htmlJob);
    expect(r.description).toContain("Ruolo chiave nel team.");
    expect(r.description).not.toContain("<strong>");
    expect(r.description).not.toContain("<br>");
  });
});

describe("buildLocation — 'city, state, country' skipping empties", () => {
  test("joins all three parts", () => {
    expect(buildLocation("Bologna", "Emilia-Romagna", "IT")).toBe("Bologna, Emilia-Romagna, IT");
  });

  test("skips missing parts", () => {
    expect(buildLocation("Bologna", undefined, "IT")).toBe("Bologna, IT");
    expect(buildLocation(undefined, undefined, "IT")).toBe("IT");
    expect(buildLocation("Bologna")).toBe("Bologna");
  });

  test("treats blank strings as missing", () => {
    expect(buildLocation(" ", "Emilia-Romagna", "IT")).toBe("Emilia-Romagna, IT");
  });

  test("returns null when every part is missing", () => {
    expect(buildLocation()).toBeNull();
    expect(buildLocation(undefined, undefined, undefined)).toBeNull();
    expect(buildLocation("", " ", "")).toBeNull();
  });
});

describe("parseJsearchDate — ISO UTC to YYYY-MM-DD", () => {
  test("parses documented timestamps", () => {
    expect(parseJsearchDate("2026-07-23T12:00:00.000Z")).toBe("2026-07-23");
    expect(parseJsearchDate("2026-01-05T08:30:00.000Z")).toBe("2026-01-05");
    expect(parseJsearchDate("2026-12-31T23:59:59Z")).toBe("2026-12-31");
  });

  test("returns null when input is missing or not ISO-shaped", () => {
    expect(parseJsearchDate(null)).toBeNull();
    expect(parseJsearchDate(undefined)).toBeNull();
    expect(parseJsearchDate("")).toBeNull();
    expect(parseJsearchDate("not a date")).toBeNull();
    expect(parseJsearchDate("2026-07-23")).toBeNull();
    expect(parseJsearchDate("23/07/2026")).toBeNull();
  });

  test("returns null for impossible month or day", () => {
    expect(parseJsearchDate("2026-13-01T00:00:00Z")).toBeNull();
    expect(parseJsearchDate("2026-00-10T00:00:00Z")).toBeNull();
    expect(parseJsearchDate("2026-07-32T00:00:00Z")).toBeNull();
    expect(parseJsearchDate("2026-07-00T00:00:00Z")).toBeNull();
  });
});

describe("loadEnvFile / getApiKey — resolve JSEARCH_API_KEY", () => {
  function envFile(contents: string): string {
    const dir = mkdtempSync(join(tmpdir(), "jsearch-env-"));
    const path = join(dir, ".env");
    writeFileSync(path, contents);
    return path;
  }

  test("parses KEY=VALUE lines, skips comments and blanks, keeps '=' in values", () => {
    const path = envFile("# comment\n\nJSEARCH_API_KEY=ak_abc=def\n   \n#OTHER=nope\n");
    expect(loadEnvFile(path)).toEqual({ JSEARCH_API_KEY: "ak_abc=def" });
    expect(loadEnv(dirname(path))).toEqual({ JSEARCH_API_KEY: "ak_abc=def" });
    rmSync(dirname(path), { recursive: true, force: true });
  });

  test("trims whitespace around keys and values", () => {
    expect(loadEnvFile(envFile("  JSEARCH_API_KEY = ak_x  \n"))).toEqual({ JSEARCH_API_KEY: "ak_x" });
  });

  test("missing file yields an empty map", () => {
    expect(loadEnvFile(join(tmpdir(), "jsearch-no-such-dir", ".env"))).toEqual({});
  });

  test("environment wins over the .env file", () => {
    const path = envFile("JSEARCH_API_KEY=from-file\n");
    const key = getApiKey(dirname(path), { JSEARCH_API_KEY: "from-env" });
    expect(key).toBe("from-env");
    rmSync(dirname(path), { recursive: true, force: true });
  });

  test("falls back to the .env file when the environment is empty", () => {
    const path = envFile("JSEARCH_API_KEY=from-file\n");
    expect(getApiKey(dirname(path), {})).toBe("from-file");
    rmSync(dirname(path), { recursive: true, force: true });
  });

  test("returns null when neither source has the key", () => {
    expect(getApiKey(join(tmpdir(), "jsearch-no-such-dir"), {})).toBeNull();
  });
});

describe("stripHtml", () => {
  test("removes tags and decodes entities", () => {
    expect(stripHtml("<p>Caf&eacute; &amp; t&eacute;cnico</p>")).toBe("Café & técnico");
  });

  test("block tags and <br> become newlines", () => {
    expect(stripHtml("<ul><li>Uno</li><li>Dos</li></ul>")).toBe("Uno\nDos");
    expect(stripHtml("Hola<br>mundo")).toBe("Hola\nmundo");
  });

  test("empty or null input yields an empty string", () => {
    expect(stripHtml("")).toBe("");
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
  });
});
