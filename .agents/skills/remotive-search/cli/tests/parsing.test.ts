import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripHtml, toResult, type RemotiveJob, type SearchResponse } from "../src/helpers";

const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search.json"), "utf8"),
) as SearchResponse;

describe("toResult - reshape a Remotive job into the portal-skill contract", () => {
  test("maps the wire fields into the contract", () => {
    const result = toResult(fixture.jobs![0]);

    expect(result).toEqual({
      id: "2091069",
      portal: "remotive",
      title: "Patient Care Specialist",
      company: "STATLINX",
      location: "USA",
      url: "https://remotive.com/remote-jobs/medical/patient-care-specialist-2091069",
      date: "2026-07-16",
      description: expect.stringContaining("answering inbound calls"),
      remote: true,
      salary: "$36k",
    });
  });

  test("always returns a string id and remote true", () => {
    const result = toResult(fixture.jobs![1]);

    expect(typeof result.id).toBe("string");
    expect(result.remote).toBe(true);
  });

  test("truncates publication_date to YYYY-MM-DD", () => {
    expect(toResult(fixture.jobs![2]).date).toBe("2026-07-16");
  });

  test("maps empty salary and location to null", () => {
    const bare: RemotiveJob = {
      ...fixture.jobs![0],
      candidate_required_location: "",
      salary: "",
    };

    const result = toResult(bare);

    expect(result.location).toBeNull();
    expect(result.salary).toBeNull();
  });

  test("maps missing optional values to null or an empty description", () => {
    const bare: RemotiveJob = {
      ...fixture.jobs![0],
      company_name: undefined,
      candidate_required_location: undefined,
      publication_date: undefined,
      salary: undefined,
      description: undefined,
    };

    expect(toResult(bare)).toMatchObject({
      company: null,
      location: null,
      date: null,
      description: "",
      remote: true,
      salary: null,
    });
  });
});

describe("stripHtml", () => {
  test("removes tags and decodes named and numeric entities", () => {
    expect(stripHtml("<p>Caf&eacute; &amp; t&eacute;cnico l&#39;azienda &#x2013; &#8364;</p>")).toBe(
      "Café & técnico l'azienda – €",
    );
  });

  test("preserves line breaks from block tags and br", () => {
    expect(stripHtml("<ul><li>Uno</li><li>Dos</li></ul>")).toBe("Uno\nDos");
    expect(stripHtml("Hola<br class=wide>mundo")).toBe("Hola\nmundo");
  });

  test("handles quoted angle brackets in tag attributes", () => {
    expect(stripHtml('<p data-note="a > b" title="x < y">Antes<br data-x="a > b"/>Después</p>')).toBe(
      "Antes\nDespués",
    );
  });

  test("leaves unknown entities, including prototype names, unchanged", () => {
    expect(stripHtml("&constructor; &toString; &unknown;")).toBe(
      "&constructor; &toString; &unknown;",
    );
  });

  test("empty or null input yields an empty string", () => {
    expect(stripHtml("")).toBe("");
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
  });
});
