import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  jobsFromHimalayasResponse,
  jobsFromRss,
  normalizeDate,
  stableHash,
  stripHtml,
  toHimalayasResult,
  toWwrResult,
  type HimalayasResponse,
} from "../src/helpers"

const wwrFixture = readFileSync(join(import.meta.dir, "fixtures", "wwr-edge-cases.rss"), "utf8")
const himalayasFixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "himalayas.json"), "utf8"),
) as HimalayasResponse

describe("WWR RSS parser", () => {
  test("scans item boundaries without breaking CDATA or quoted > attributes", () => {
    const jobs = jobsFromRss(wwrFixture)

    expect(jobs).toHaveLength(6)
    expect(jobs[0]).toMatchObject({
      title: "Acme: AI Consultant",
      region: "Anywhere & Europe",
      link: "https://example.test/jobs/ai-consultant?a=1&b=2",
    })
    expect(jobs[0]?.description).toContain("data-note=\"1 > 0\"")
    expect(jobs[1]?.title).toBe("No Company Role & Design")
  })

  test("maps company/title, HTML, region, strict date, and stable URL hash", () => {
    const jobs = jobsFromRss(wwrFixture)
    const result = toWwrResult(jobs[0]!)

    expect(result).toEqual({
      id: stableHash("https://example.test/jobs/ai-consultant?a=1&b=2"),
      portal: "wwr",
      title: "AI Consultant",
      company: "Acme",
      location: "Anywhere & Europe",
      url: "https://example.test/jobs/ai-consultant?a=1&b=2",
      date: "2026-07-22",
      description: "Care & AI\nLine\nTwo",
      remote: true,
      salary: null,
    })
  })

  test("keeps a title without a colon and null company", () => {
    const result = toWwrResult(jobsFromRss(wwrFixture)[1]!)

    expect(result?.title).toBe("No Company Role & Design")
    expect(result?.company).toBeNull()
    expect(result?.location).toBe("Remote")
    expect(result?.date).toBe("2026-07-23")
    expect(result?.description).toBe('Healthcare only, with a\nvisible break.')
  })

  test("returns null for invalid dates, skips missing links, and keeps duplicate IDs stable", () => {
    const jobs = jobsFromRss(wwrFixture)

    expect(toWwrResult(jobs[2]!)?.date).toBeNull()
    expect(toWwrResult(jobs[4]!)).toBeNull()
    expect(toWwrResult(jobs[0]!)?.id).toBe(toWwrResult(jobs[3]!)?.id)
  })
})

describe("Himalayas JSON mapping", () => {
  test("validates the jobs envelope and maps the verified response shape", () => {
    const jobs = jobsFromHimalayasResponse(himalayasFixture)
    const result = toHimalayasResult(jobs[0]!)

    expect(jobs).toHaveLength(3)
    expect(result).toMatchObject({
      id: "https://himalayas.app/companies/sosafe/jobs/staff-product-manager-enterprise-platform",
      portal: "himalayas",
      title: "Staff Product Manager - Enterprise Platform",
      company: "SoSafe",
      location: "Ireland, Portugal, United Kingdom",
      url: "https://himalayas.app/companies/sosafe/jobs/staff-product-manager-enterprise-platform",
      date: "2026-07-22",
      remote: true,
      salary: null,
    })
    expect(result?.description).toBe("Own the enterprise control plane and platform capabilities.")
  })

  test("maps explicit salary and worldwide location safely", () => {
    const result = toHimalayasResult(jobsFromHimalayasResponse(himalayasFixture)[2]!)

    expect(result?.location).toBe("Canada, United States")
    expect(result?.salary).toBe("USD 192000-285000 annual")
    expect(toHimalayasResult({
      title: "Worldwide role",
      companyName: "Example",
      locationRestrictions: [],
      description: "<p>Remote</p>",
      applicationLink: "https://himalayas.app/jobs/worldwide",
      pubDate: "2026-07-22",
    })?.location).toBe("Worldwide")
  })

  test("rejects malformed envelopes and rows without a usable title or URL", () => {
    expect(() => jobsFromHimalayasResponse({ jobs: "not an array" })).toThrow("invalid response body")
    expect(toHimalayasResult({ title: 42, applicationLink: "https://example.test/job" })).toBeNull()
    expect(toHimalayasResult({ title: "No URL" })).toBeNull()
  })
})

describe("hardened text and dates", () => {
  test("strips tags with quoted > attributes and decodes common/numeric entities", () => {
    expect(stripHtml('<p>Caf&eacute; &amp; t&eacute;cnico<br data-note="x > y">l&#39;azienda &#x2013; &#8364;</p>')).toBe(
      "Café & técnico\nl'azienda – €",
    )
    expect(stripHtml("&constructor; &toString; &unknown;")).toBe(
      "&constructor; &toString; &unknown;",
    )
  })

  test("normalizes valid RFC/ISO dates and rejects rollover-prone values", () => {
    expect(normalizeDate("Tue, 30 Jun 2026 20:32:52 +0000")).toBe("2026-06-30")
    expect(normalizeDate("Tue, 30 Jun 2026 20:32:52 GMT")).toBe("2026-06-30")
    expect(normalizeDate("2024-02-29")).toBe("2024-02-29")
    expect(normalizeDate("2025-02-29")).toBeNull()
    expect(normalizeDate("31 Feb 2026 12:00:00 +0000")).toBeNull()
    expect(normalizeDate("not-a-date")).toBeNull()
    expect(normalizeDate(Number.POSITIVE_INFINITY)).toBeNull()
  })
})
