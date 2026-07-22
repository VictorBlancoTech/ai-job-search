import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  jobsFromResponse,
  normalizeDate,
  normalizeProvince,
  stripHtml,
  toDetail,
  toResult,
  type InfoJobsOffer,
} from "../src/helpers"

const searchFixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search.json"), "utf8"),
) as unknown
const detailFixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "detail.json"), "utf8"),
) as InfoJobsOffer

describe("InfoJobs response mapping", () => {
  test("maps the documented search fields to the unified contract", () => {
    const offers = jobsFromResponse(searchFixture)
    const result = toResult(offers[0]!)

    expect(result).toEqual({
      id: "abc123remote",
      portal: "infojobs",
      title: "Responsable IT",
      company: "Ejemplo Tecnología",
      location: "Madrid",
      url: "https://www.infojobs.net/madrid/responsable-it/of-abc123remote",
      date: "2026-07-22",
      description: "Experiencia & liderazgo\nGestión de equipos",
      remote: true,
      salary: "30.000 €-40.000 € Bruto/año",
    })
  })

  test("uses city and province without duplicating them, and falls back to published date", () => {
    const result = toResult(jobsFromResponse(searchFixture)[1]!)

    expect(result).toMatchObject({
      id: "def456onsite",
      company: "Empresa Ejemplo",
      location: "Valencia",
      date: "2026-07-21",
      remote: false,
      salary: null,
      description: "Atención <cliente>",
    })
  })

  test("maps detail with the full description and detail date fields", () => {
    expect(toDetail(detailFixture, "requested-id")).toEqual({
      id: "abc123remote",
      portal: "infojobs",
      title: "Responsable IT",
      company: "Ejemplo Tecnología",
      location: "Madrid",
      url: "https://www.infojobs.net/madrid/responsable-it/of-abc123remote",
      date: "2026-07-22",
      description: "Descripción completa & segura.\nResponsabilidades",
      remote: true,
      salary: "35.000 €-45.000 € Bruto/año",
    })
  })

  test("skips malformed rows and rejects malformed envelopes without crashing", () => {
    const offers = jobsFromResponse(searchFixture)
    expect(offers).toHaveLength(3)
    expect(toResult(offers[2]!)).toBeNull()
    expect(() => jobsFromResponse({ offers: "not-an-array" })).toThrow("invalid response body")
    expect(toDetail({ title: "Missing URL" }, "requested-id")).toBeNull()
  })
})

describe("safe HTML, teleworking, salary, and dates", () => {
  test("strips tags with quoted > attributes and decodes safe entities", () => {
    expect(stripHtml('<p>Caf&eacute; &amp; técnico<br data-note="x > y">l&#39;empresa &#x2013; &#8364;</p>')).toBe(
      "Café & técnico\nl'empresa – €",
    )
    expect(stripHtml("&constructor; &toString; &unknown;")).toBe("&constructor; &toString; &unknown;")
  })

  test("returns true only for explicit remote values, false only for onsite, and null otherwise", () => {
    const base: InfoJobsOffer = {
      id: "id",
      title: "Role",
      link: "https://example.test/role",
    }
    expect(toResult({ ...base, teleworking: "Teletrabajo" })?.remote).toBe(true)
    expect(toResult({ ...base, teleworking: "Presencial" })?.remote).toBe(false)
    expect(toResult({ ...base, teleworking: "Híbrido" })?.remote).toBeNull()
    expect(toResult({ ...base, teleworking: "No indicado" })?.remote).toBeNull()
  })

  test("does not infer salary from a period without explicit bounds", () => {
    const base: InfoJobsOffer = {
      id: "id",
      title: "Role",
      link: "https://example.test/role",
      salaryPeriod: { value: "Bruto/año" },
    }
    expect(toResult(base)?.salary).toBeNull()
    expect(toResult({ ...base, salaryDescription: "35.000 - 45.000 € Bruto/año" })?.salary).toBe(
      "35.000 - 45.000 € Bruto/año",
    )
  })

  test("normalizes friendly province names to documented API keys", () => {
    expect(normalizeProvince("Madrid")).toBe("madrid")
    expect(normalizeProvince("Álava")).toBe("alava")
    expect(normalizeProvince("Santa Cruz de Tenerife")).toBe("santa-cruz-de-tenerife")
    expect(normalizeProvince("madrid")).toBe("madrid")
  })

  test("normalizes strict dates and rejects impossible or malformed values", () => {
    expect(normalizeDate("2026-07-22T10:30:00.000Z")).toBe("2026-07-22")
    expect(normalizeDate("2026-07-22T10:30:00.000+0000")).toBe("2026-07-22")
    expect(normalizeDate("2024-02-29")).toBe("2024-02-29")
    expect(normalizeDate("2025-02-29T10:00:00Z")).toBeNull()
    expect(normalizeDate("2026-13-01T10:00:00Z")).toBeNull()
    expect(normalizeDate("not-a-date")).toBeNull()
  })
})
