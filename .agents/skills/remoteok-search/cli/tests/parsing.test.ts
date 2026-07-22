import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { stripHtml, toResult, type RemoteOkJob } from "../src/helpers"

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search.json"), "utf8"),
) as unknown[]

function fixtureJob(id: string): RemoteOkJob {
  return fixture.find(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { id?: unknown }).id === id,
  ) as RemoteOkJob
}

describe("toResult - reshape a RemoteOK job into the portal-skill contract", () => {
  test("maps fields, strips the description, defaults location, and keeps remote true", () => {
    expect(toResult(fixtureJob("1135014"))).toEqual({
      id: "1135014",
      portal: "remoteok",
      title: "React Native Engineer",
      company: "HelpBnk",
      location: "Worldwide",
      url: "https://remoteOK.com/remote-jobs/remote-react-native-engineer-helpbnk-1135014",
      date: "2026-07-18",
      description: "Build native mobile applications & tools.\nReact Native and iOS support.",
      remote: true,
      salary: "60000-80000",
    })
  })

  test("uses a stable string id and falls back to the canonical RemoteOK URL", () => {
    const result = toResult(fixtureJob("9002"))

    expect(typeof result.id).toBe("string")
    expect(result.url).toBe("https://remoteok.com/remote-jobs/9002")
    expect(result.date).toBe("2026-07-16")
  })

  test("returns null salary unless both bounds are positive", () => {
    expect(toResult(fixtureJob("9001")).salary).toBeNull()
    expect(toResult(fixtureJob("9002")).salary).toBeNull()
    expect(toResult(fixtureJob("9003")).salary).toBe("1000-2000")
  })

  test("does not crash on null optional fields", () => {
    expect(toResult(fixtureJob("9004"))).toEqual({
      id: "9004",
      portal: "remoteok",
      title: "(untitled)",
      company: null,
      location: "Worldwide",
      url: "https://remoteok.com/remote-jobs/9004",
      date: null,
      description: "",
      remote: true,
      salary: null,
    })
  })
})

describe("stripHtml", () => {
  test("removes tags and decodes named and numeric entities", () => {
    expect(stripHtml("<p>Caf&eacute; &amp; t&eacute;cnico l&#39;azienda &#x2013; &#8364;</p>")).toBe(
      "Café & técnico l'azienda – €",
    )
  })

  test("preserves readable breaks from block tags and br", () => {
    expect(stripHtml("<ul><li>Uno</li><li>Dos</li></ul>")).toBe("Uno\nDos")
    expect(stripHtml("Hola<br class=wide>mundo")).toBe("Hola\nmundo")
  })

  test("handles quoted angle brackets in tag attributes", () => {
    expect(stripHtml('<p data-note="a > b" title="x < y">Antes<br data-x="a > b"/>Después</p>')).toBe(
      "Antes\nDespués",
    )
  })

  test("leaves unknown entities, including prototype names, unchanged", () => {
    expect(stripHtml("&constructor; &toString; &unknown;")).toBe(
      "&constructor; &toString; &unknown;",
    )
  })

  test("empty or null input yields an empty string", () => {
    expect(stripHtml("")).toBe("")
    expect(stripHtml(null)).toBe("")
    expect(stripHtml(undefined)).toBe("")
  })
})
