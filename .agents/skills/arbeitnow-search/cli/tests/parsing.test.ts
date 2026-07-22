import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  jobsFromResponse,
  stripHtml,
  toResult,
  type ArbeitnowJob,
  type SearchResponse,
} from "../src/helpers"

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search.json"), "utf8"),
) as SearchResponse

const fixtureJobs = jobsFromResponse(fixture)

describe("Arbeitnow response envelope", () => {
  test("reads the real data envelope and ignores non-job array entries", () => {
    expect(fixtureJobs).toHaveLength(6)
    expect(fixtureJobs[0].slug).toBe("bershka-traineeprogramm-lead-in-fashion-frankfurt-am-main-416996")
  })

  test("rejects a response without a data array", () => {
    expect(() => jobsFromResponse({ data: {} })).toThrow("invalid response body")
  })
})

describe("toResult", () => {
  test("maps the live fixture into the unified result contract", () => {
    expect(toResult(fixtureJobs[0])).toEqual({
      id: "bershka-traineeprogramm-lead-in-fashion-frankfurt-am-main-416996",
      portal: "arbeitnow",
      title: "Bershka - Traineeprogramm Lead in Fashion (m/w/d)",
      company: "Bershka Deutschland B.V & Co. KG",
      location: "Frankfurt am Main",
      url: "https://www.arbeitnow.com/jobs/companies/bershka-deutschland-bv-co-kg/bershka-traineeprogramm-lead-in-fashion-frankfurt-am-main-416996",
      date: "2026-07-22",
      description: expect.stringContaining("MAKE IT YOURS!"),
      remote: false,
      salary: null,
    })
  })

  test("maps the actual boolean remote field", () => {
    expect(toResult(fixtureJobs[5])?.remote).toBe(true)
  })

  test("normalizes ISO dates and rejects impossible or garbage dates", () => {
    const base: ArbeitnowJob = {
      slug: "date-test",
      title: "Date test",
      url: "https://example.test/date-test",
    }

    expect(toResult({ ...base, created_at: "2025-02-03T12:30:00Z" })?.date).toBe("2025-02-03")
    expect(toResult({ ...base, created_at: "2024-02-29" })?.date).toBe("2024-02-29")
    expect(toResult({ ...base, created_at: "2025-02-29" })?.date).toBeNull()
    expect(toResult({ ...base, created_at: "not-a-date" })?.date).toBeNull()
    expect(toResult({ ...base, created_at: Number.POSITIVE_INFINITY })?.date).toBeNull()
  })

  test("maps malformed optional fields safely and never infers salary", () => {
    const result = toResult({
      slug: "malformed-fields",
      title: "Valid title",
      url: "https://example.test/malformed-fields",
      company_name: 42,
      location: { name: "Berlin" },
      description: { html: "<p>not a string</p>" },
      remote: "yes",
      salary: "100000 EUR",
      created_at: null,
    })

    expect(result).toMatchObject({
      company: null,
      location: null,
      description: "",
      remote: null,
      date: null,
      salary: null,
    })
  })

  test("uses a stable URL or id when slug is missing", () => {
    expect(
      toResult({ title: "URL id", url: "https://example.test/jobs/url-id" })?.id,
    ).toBe("https://example.test/jobs/url-id")
    expect(
      toResult({ title: "Explicit id", id: 123, url: "https://example.test/jobs/123" })?.id,
    ).toBe("123")
  })

  test("skips entries without a string title or stable URL", () => {
    expect(toResult({ slug: "bad-title", title: 123, url: "https://example.test/bad-title" })).toBeNull()
    expect(toResult({ slug: "bad-url", title: "Missing URL" })).toBeNull()
    expect(toResult({ slug: "empty-url", title: "Empty URL", url: "" })).toBeNull()
  })
})

describe("stripHtml", () => {
  test("removes tags and decodes named and numeric entities", () => {
    expect(stripHtml("<p>Caf&eacute; &amp; t&eacute;cnico l&#39;azienda &#x2013; &#8364;</p>")).toBe(
      "Café & técnico l'azienda – €",
    )
  })

  test("preserves readable line breaks and tolerates malformed HTML", () => {
    expect(stripHtml("<ul><li>Uno</li><li>Dos</li></ul>")).toBe("Uno\nDos")
    expect(stripHtml("Hola<br class=wide>mundo")).toBe("Hola\nmundo")
    expect(stripHtml("<p>Texto <strong")).toBe("Texto <strong")
  })

  test("does not resolve entities through Object.prototype", () => {
    expect(stripHtml("&constructor; &toString; &unknown;")).toBe(
      "&constructor; &toString; &unknown;",
    )
  })

  test("returns an empty string for non-string descriptions", () => {
    expect(stripHtml(null)).toBe("")
    expect(stripHtml(undefined)).toBe("")
    expect(stripHtml({})).toBe("")
  })
})
