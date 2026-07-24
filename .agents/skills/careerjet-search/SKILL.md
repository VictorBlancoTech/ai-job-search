---
name: careerjet-search
version: 1.0.0
description: >
  Use this skill to search live job listings via the Careerjet public API — a
  free job aggregator with no authentication required, covering Italy, Spain
  and 90+ countries. Trigger phrases: find a job, job search, careerjet jobs,
  ofertas de empleo, offerte di lavoro, buscar empleo, cercare lavoro.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/careerjet-search/cli/src/cli.ts *)
---

# careerjet-search — Skill de portal (API pública sin key)

Busca ofertas via [Careerjet Public API](https://www.careerjet.com/partners/api/).
Sin autenticación — solo `User-Agent` educado.

## Autenticación

Ninguna. No requiere `.env` ni variables de entorno.

## Comandos

### Buscar ofertas

```bash
bun run .agents/skills/careerjet-search/cli/src/cli.ts search [-q "<kw>"] [-l "<loc>"] [--country it|es] [--limit N] [--format json|table|plain]
```

Flags:
- `--query <texto>` / `-q` — palabras clave. Opcional.
- `--where <texto>` / `-l` — localización (ciudad, región). Opcional.
- `--country <it|es>` — locale de Careerjet (`it_IT` / `es_ES`). Default `it`.
- `--page <n>` — página 1-indexada. Default 1.
- `--limit <n>` / `-n` — resultados por página (máx. 99). Default 25.
- `--format json|table|plain` — default `json`.

## Ejemplos

```bash
# Responsabile IT en Bolonia (Italia)
bun run .agents/skills/careerjet-search/cli/src/cli.ts search -q "responsabile it" -l "Bologna" --country it --format table

# AI Consultant remoto en España
bun run .agents/skills/careerjet-search/cli/src/cli.ts search -q "AI consultant" --country es --limit 10 --format json
```

## Contrato de salida

Mismo schema que `adzuna-search`:

```json
{
  "meta": { "portal": "careerjet", "count": 2, "query": "...", "location": "..." },
  "results": [
    {
      "id": "<sha1 of url>",
      "portal": "careerjet",
      "title": "...",
      "company": "...",
      "location": "...",
      "url": "https://...",
      "date": "2026-07-23",
      "description": "...",
      "remote": null,
      "salary": "40000-50000 EUR"
    }
  ]
}
```

Notas:
- `id` es sha1 de la URL (Careerjet no expone id estable).
- `date` parseado de formato local a `YYYY-MM-DD`; `null` si no parseable.
- `salary` es `"min-max EUR"` si `salary_min` y `salary_max` presentes; si no, `null`.
- `remote` es siempre `null`: Careerjet no expone campo de remoto — nunca se infiere.

## Tests

```bash
cd .agents/skills/careerjet-search/cli && bun test
```

Los tests corren contra `tests/fixtures/search-it.json` — respuesta real recortada — y no tocan la red.
