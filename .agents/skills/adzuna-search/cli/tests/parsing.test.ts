import { describe, test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { loadEnv, loadEnvFile, stripHtml, toResult, type AdzunaJob } from "../src/helpers";

// Real Adzuna API response (portal `it`, 3 results), trimmed for the fixture:
// [0] full result without salary, [1] with salary_min+salary_max, [2] no salary.
const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search-it.json"), "utf8"),
) as { results: AdzunaJob[] };

describe("toResult — reshape an Adzuna job into the portal-skill contract", () => {
  test("maps the wire fields into the contract", () => {
    const r = toResult(fixture.results[0]);
    expect(r).toEqual({
      id: "5716163568",
      portal: "adzuna",
      title: "Consulente commerciale IT",
      company: "Rewind",
      location: "Bologna, Provincia di Bologna",
      url: "https://www.adzuna.it/details/5716163568?utm_medium=api&utm_source=7d3cc114",
      date: "2026-05-01",
      description: expect.any(String),
      remote: null,
      salary: null,
    });
  });

  test("id is a string and date is YYYY-MM-DD (from created)", () => {
    const r = toResult(fixture.results[0]);
    expect(typeof r.id).toBe("string");
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("company comes from company.display_name, location from location.display_name", () => {
    expect(toResult(fixture.results[2]).company).toBe("MAW");
    expect(toResult(fixture.results[2]).location).toBe("Milano, Provincia di Milano");
  });

  test("salary is \"min-max EUR\" when both bounds exist", () => {
    const r = toResult(fixture.results[1]);
    expect(r.salary).toBe("24000-33600 EUR");
  });

  test("salary is null when a bound is missing", () => {
    const onlyMin: AdzunaJob = { ...fixture.results[1], salary_max: undefined };
    const onlyMax: AdzunaJob = { ...fixture.results[1], salary_min: undefined };
    expect(toResult(onlyMin).salary).toBeNull();
    expect(toResult(onlyMax).salary).toBeNull();
    expect(toResult(fixture.results[0]).salary).toBeNull();
  });

  test("missing company/location/description degrade to null or empty string", () => {
    const bare: AdzunaJob = {
      ...fixture.results[0],
      company: undefined,
      location: undefined,
      description: undefined,
      created: undefined,
    };
    const r = toResult(bare);
    expect(r.company).toBeNull();
    expect(r.location).toBeNull();
    expect(r.description).toBe("");
    expect(r.date).toBeNull();
    expect(r.remote).toBeNull();
  });

  test("description is stripped of HTML", () => {
    const withHtml: AdzunaJob = {
      ...fixture.results[0],
      description: "<strong>Responsabile IT</strong><br>Gestione &amp; sviluppo",
    };
    expect(toResult(withHtml).description).toBe("Responsabile IT\nGestione & sviluppo");
  });
});

describe("loadEnvFile — parse a .env file", () => {
  function envFile(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), "adzuna-env-"));
    const path = join(dir, ".env");
    writeFileSync(path, content);
    return path;
  }

  test("parses KEY=VALUE pairs", () => {
    const path = envFile("ADZUNA_APP_ID=7d3cc114\nADZUNA_APP_KEY=abc123\n");
    const env = loadEnvFile(path);
    expect(env.ADZUNA_APP_ID).toBe("7d3cc114");
    expect(env.ADZUNA_APP_KEY).toBe("abc123");
    expect(loadEnv(dirname(path))).toEqual(env);
  });

  test("ignores comments and blank lines", () => {
    const env = loadEnvFile(envFile("# comment\n\nADZUNA_APP_ID=x\n   \n#ADZUNA_APP_KEY=nope\n"));
    expect(env).toEqual({ ADZUNA_APP_ID: "x" });
  });

  test("trims whitespace and keeps = inside values", () => {
    const env = loadEnvFile(envFile("  KEY = a=b=c  \n"));
    expect(env.KEY).toBe("a=b=c");
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

  test("handles br attributes and quoted > or < characters in attributes", () => {
    expect(stripHtml('<p data-note="a > b" title="x < y">Antes<br class="wide">Después<br data-x="a > b"/>Fin</p>')).toBe(
      "Antes\nDespués\nFin",
    );
  });

  test("decodes common currency, dash, and numeric entities", () => {
    expect(stripHtml("<p>&euro; 10&nbsp;&ndash; 20 &mdash; &#8364; &#x2013; &#x2014;</p>")).toBe(
      "€ 10 – 20 — € – —",
    );
  });

  test("decodes numeric entities", () => {
    expect(stripHtml("l&#39;azienda")).toBe("l'azienda");
  });

  test("empty or null input yields an empty string", () => {
    expect(stripHtml("")).toBe("");
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
  });
});
