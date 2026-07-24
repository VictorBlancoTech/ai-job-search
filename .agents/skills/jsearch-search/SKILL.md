---
name: jsearch-search
version: 1.0.0
description: >
  Use this skill to search live job listings via the JSearch API (OpenWebNinja)
  — a freemium aggregator that combines LinkedIn, Indeed, Glassdoor and others
  into a single schema. ~200 requests/month free tier. Trigger phrases: find
  a job, jsearch jobs, openwebninja, ofertas de empleo, offerte di lavoro.
context: fork
enabled: false
allowed-tools: Bash(bun run .agents/skills/jsearch-search/cli/src/cli.ts *)
---

# jsearch-search — Skill de portal (agregador freemium)

Busca ofertas via [JSearch API (OpenWebNinja)](https://www.openwebninja.com/jsearch).
**Status: `enabled: false`** pendiente de evaluación de overlap con el pipeline
existente (LinkedIn + Adzuna + InfoJobs). Si aporta >20% ofertas nuevas, activar.

## Autenticación

`JSEARCH_API_KEY` en `.env` o variable de entorno. Exit 2 si falta.

**Cuota freemium:** ~200 req/mes. El CLI imprime un warning si quedan <20
requests (header `X-RateLimit-Remaining`).

## Comandos

### Buscar ofertas

```bash
bun run .agents/skills/jsearch-search/cli/src/cli.ts search [-q "<kw>"] [-l "<loc>"] [--country it|es] [--limit N] [--remote] [--format json|table|plain]
```

Flags:
- `--query <texto>` / `-q` — palabras clave. Opcional pero recomendado.
- `--where <texto>` / `-l` — localización. Se concatena al query ("kw in loc").
- `--country <it|es>` — código ISO. Default `it`.
- `--page <n>` — página 1-indexada. Default 1.
- `--limit <n>` / `-n` — resultados por página (máx. 20). Default 10.
- `--remote` — solo trabajos remotos.
- `--format json|table|plain` — default `json`.

## Ejemplos

```bash
# IT Manager en Bolonia
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "IT Manager" -l "Bologna" --country it

# AI Consultant remoto en España
bun run .agents/skills/jsearch-search/cli/src/cli.ts search -q "AI consultant" --country es --remote --limit 20
```

## Contrato de salida

Mismo schema que `adzuna-search`:

```json
{
  "meta": { "portal": "jsearch", "count": 2, "query": "...", "location": "..." },
  "results": [
    {
      "id": "abc123",
      "portal": "jsearch",
      "title": "IT Manager",
      "company": "Acme SpA",
      "location": "Bologna, Emilia-Romagna, IT",
      "url": "https://...",
      "date": "2026-07-23",
      "description": "...",
      "remote": false,
      "salary": "40000-50000 EUR"
    }
  ]
}
```

Notas:
- `id` es `job_id` directo de la API.
- `location` se construye como `"<city>, <state>, <country>"` (omite partes vacías).
- `date` es `job_posted_at_datetime_utc` recortado a `YYYY-MM-DD`.
- `remote` es `job_is_remote` directo (boolean).
- `salary` es `"min-max CUR"` si ambos límites presentes; si no, `null`.

## Tests

```bash
cd .agents/skills/jsearch-search/cli && bun test
```

Los tests corren contra `tests/fixtures/search-it.json` — respuesta real recortada — y no tocan la red.
