import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseCareerjetDate,
  stableId,
  stripHtml,
  toResult,
  type CareerjetJob,
} from "../src/helpers";

// Synthetic Careerjet API response (locale it_IT, 3 results), shaped per the
// documented public schema: [0] full result without salary, [1] with
// salary_min+salary_max, [2] bare-bones without salary.
const fixture = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "search-it.json"), "utf8"),
) as { jobs: CareerjetJob[] };

describe("toResult — reshape a Careerjet job into the portal-skill contract", () => {
  test("maps the wire fields into the contract", () => {
    const job = fixture.jobs[0];
    const r = toResult(job);
    expect(r).toEqual({
      id: stableId(job.url!),
      portal: "careerjet",
      title: "Responsabile IT",
      company: "TechNova",
      location: "Bologna, Emilia-Romagna",
      url: "https://www.careerjet.it/job/view/abc123-responsabile-it-bologna.html",
      date: "2026-07-23",
      description: expect.any(String),
      remote: null,
      salary: null,
    });
  });

  test("id is a sha1 hex string derived from the URL", () => {
    const r = toResult(fixture.jobs[0]);
    expect(r.id).toMatch(/^[0-9a-f]{40}$/);
    expect(r.id).toBe(stableId(fixture.jobs[0].url!));
  });

  test("company comes from the flat company field, location from locations", () => {
    expect(toResult(fixture.jobs[2]).company).toBe("DataCo");
    expect(toResult(fixture.jobs[2]).location).toBe("Roma, Lazio");
  });

  test("salary is \"min-max EUR\" when both bounds exist", () => {
    const r = toResult(fixture.jobs[1]);
    expect(r.salary).toBe("40000-50000 EUR");
  });

  test("salary is null when a bound is missing", () => {
    const onlyMin: CareerjetJob = { ...fixture.jobs[1], salary_max: undefined };
    const onlyMax: CareerjetJob = { ...fixture.jobs[1], salary_min: undefined };
    expect(toResult(onlyMin).salary).toBeNull();
    expect(toResult(onlyMax).salary).toBeNull();
    expect(toResult(fixture.jobs[0]).salary).toBeNull();
    expect(toResult(fixture.jobs[2]).salary).toBeNull();
  });

  test("missing company/locations/description degrade to null or empty string", () => {
    const bare: CareerjetJob = {
      url: fixture.jobs[0].url,
      title: fixture.jobs[0].title,
    };
    const r = toResult(bare);
    expect(r.company).toBeNull();
    expect(r.location).toBeNull();
    expect(r.description).toBe("");
    expect(r.date).toBeNull();
    expect(r.remote).toBeNull();
    expect(r.salary).toBeNull();
  });

  test("description is stripped of HTML", () => {
    const r = toResult(fixture.jobs[0]);
    expect(r.description).toContain("Responsabile IT");
    expect(r.description).not.toContain("<strong>");
    expect(r.description).not.toContain("<br>");
  });
});

describe("stableId — sha1 of the URL", () => {
  test("matches a known sha1 vector", () => {
    // `printf 'https://example.com/' | shasum`
    expect(stableId("https://example.com/")).toBe("b559c7edd3fb67374c1a25e739cdd7edd1d79949");
    // `printf '' | shasum`
    expect(stableId("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
  });

  test("is deterministic for the same URL", () => {
    const url = fixture.jobs[0].url!;
    expect(stableId(url)).toBe(stableId(url));
  });

  test("differs across distinct URLs", () => {
    expect(stableId(fixture.jobs[0].url!)).not.toBe(stableId(fixture.jobs[1].url!));
  });
});

describe("parseCareerjetDate — localized date to YYYY-MM-DD", () => {
  test("parses Italian dates", () => {
    expect(parseCareerjetDate("mercoledì, 23 luglio 2026")).toBe("2026-07-23");
    expect(parseCareerjetDate("lunedì, 21 luglio 2026")).toBe("2026-07-21");
    expect(parseCareerjetDate("venerdì, 18 luglio 2026")).toBe("2026-07-18");
    expect(parseCareerjetDate("giovedì, 1 gennaio 2026")).toBe("2026-01-01");
    expect(parseCareerjetDate("domenica, 31 dicembre 2026")).toBe("2026-12-31");
  });

  test("parses Spanish dates", () => {
    expect(parseCareerjetDate("miércoles, 23 julio 2026")).toBe("2026-07-23");
    expect(parseCareerjetDate("lunes, 5 enero 2026")).toBe("2026-01-05");
    expect(parseCareerjetDate("martes, 15 abril 2026")).toBe("2026-04-15");
    expect(parseCareerjetDate("viernes, 18 septiembre 2026")).toBe("2026-09-18");
    expect(parseCareerjetDate("sábado, 5 mayo 2026")).toBe("2026-05-05");
  });

  test("parses English dates (defensive)", () => {
    expect(parseCareerjetDate("Wednesday, 23 July 2026")).toBe("2026-07-23");
    expect(parseCareerjetDate("Monday, 1 January 2026")).toBe("2026-01-01");
  });

  test("pads day and month to two digits", () => {
    expect(parseCareerjetDate("lunes, 5 enero 2026")).toBe("2026-01-05");
  });

  test("returns null when input is missing or unparseable", () => {
    expect(parseCareerjetDate(null)).toBeNull();
    expect(parseCareerjetDate(undefined)).toBeNull();
    expect(parseCareerjetDate("")).toBeNull();
    expect(parseCareerjetDate("not a date")).toBeNull();
    expect(parseCareerjetDate("mercoledì, 23 smarch 2026")).toBeNull();
    expect(parseCareerjetDate("mercoledì, 32 luglio 2026")).toBeNull();
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

  test("decodes common currency, dash, and numeric entities", () => {
    expect(stripHtml("<p>&euro; 10&nbsp;&ndash; 20 &mdash; &#8364; &#x2013; &#x2014;</p>")).toBe(
      "€ 10 – 20 — € – —",
    );
  });

  test("empty or null input yields an empty string", () => {
    expect(stripHtml("")).toBe("");
    expect(stripHtml(null)).toBe("");
    expect(stripHtml(undefined)).toBe("");
  });
});
