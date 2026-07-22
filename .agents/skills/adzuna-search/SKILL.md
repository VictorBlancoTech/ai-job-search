---
name: adzuna-search
version: 1.0.0
description: >
  Use this skill to search live job listings in Italy or Spain via the official
  Adzuna Jobs API (adzuna.it / adzuna.es) — a free, first-party aggregator that
  covers all sectors and roles with one client and one credential pair. This is
  the repo's Tier 1 primary source for the IT/ES markets and the reference
  implementation for the other portal skills. Trigger phrases: find a job, job
  search, search for jobs, job openings, vacancies, hiring, positions open,
  remote jobs, "are there any X jobs in <place>", buscar empleo, buscar trabajo,
  ofertas de empleo, ofertas de trabajo, cercare lavoro, offerte di lavoro,
  annunci di lavoro, look up this Adzuna job posting.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/adzuna-search/cli/src/cli.ts *)
---

# adzuna-search — Skill de portal (Tier 1, referencia)

Busca ofertas de empleo en **Italia y España** a través de la **[API oficial de
Adzuna](https://developer.adzuna.com/)** — un agregador con portales propios
(`adzuna.it`, `adzuna.es`) y API REST gratuita. Un solo cliente y un solo par de
credenciales cubren ambos mercados, todos los sectores. **Cero dependencias de
runtime**: corre con solo `bun`.

> Esta es la implementación de referencia del patrón de skills de portales del
> repo (como `freehire-search` y `linkedin-search`), y la fuente **Tier 1
> primaria**: API oficial, estructurada y sin scraping.

## Autenticación

La API requiere un par `app_id` / `app_key` gratuitos (registro en
<https://developer.adzuna.com/>). El CLI los resuelve en este orden:

1. Variables de entorno `ADZUNA_APP_ID` y `ADZUNA_APP_KEY`.
2. El archivo `.env` en la raíz del repo (gitignored).

Si falta cualquiera de las dos, el proceso escribe un error claro a stderr y
termina con **exit code 2**.

**Límites del free tier:** 25 llamadas/minuto y 250 llamadas/día. Una búsqueda =
una llamada (las descripciones vienen inline). Ante un 429 o 5xx el CLI
reintenta una vez con backoff de 2s y luego falla con exit 1.

## Cuándo usar esta skill

- Buscar ofertas por palabras clave y/o localización en Italia o España.
- Como primera fuente del pipeline `/scrape` para los mercados IT/ES.
- Cuando necesites la descripción completa sin una segunda llamada (viene
  inline en los resultados de búsqueda — no hay comando `detail`).

## Comandos

### Buscar ofertas

```bash
bun run .agents/skills/adzuna-search/cli/src/cli.ts search [-q "<keywords>"] [-l "<lugar>"] [flags]
```

Flags:
- `--query <texto>` / `-q` — palabras clave (título, descripción). Opcional.
- `--where <texto>` / `-l` — localización (ciudad, región). Opcional.
- `--country <it|es>` — portal de Adzuna. Default `it`.
- `--page <n>` — página 1-indexada. Default 1.
- `--limit <n>` / `-n` — resultados por página (máx. API: 50). Default 25.
- `--format json|table|plain` — default `json`.

## Ejemplos

```bash
# Responsabile IT en Bolonia (Italia), vista tabla
bun run .agents/skills/adzuna-search/cli/src/cli.ts search -q "responsabile it" -l "Bologna" --country it --format table

# Responsable IT en España, JSON para pipeline
bun run .agents/skills/adzuna-search/cli/src/cli.ts search -q "responsable it" --country es --limit 10 --format json

# Desarrollador en Madrid, página 2
bun run .agents/skills/adzuna-search/cli/src/cli.ts search -q "desarrollador" -l "Madrid" --country es --page 2
```

## Contrato de salida

`search --format json` devuelve:

```json
{
  "meta": { "portal": "adzuna", "count": 2, "query": "responsabile it", "location": "Bologna" },
  "results": [
    {
      "id": "5716163568",
      "portal": "adzuna",
      "title": "Consulente commerciale IT",
      "company": "Rewind",
      "location": "Bologna, Provincia di Bologna",
      "url": "https://www.adzuna.it/details/5716163568?...",
      "date": "2026-05-01",
      "description": "Cerchiamo Responsabile Commerciale IT ...",
      "remote": null,
      "salary": "24000-33600 EUR"
    }
  ]
}
```

Notas del contrato:
- `id` es el id estable del portal (string); `url` es el `redirect_url` de
  Adzuna (página de la oferta en adzuna.it / adzuna.es).
- `date` es `created` recortado a `YYYY-MM-DD`; `null` si la API no lo trae.
- `description` viene con el HTML strippeado (tags fuera, entidades HTML comunes
  con nombre y entidades numéricas decodificadas).
- `salary` es `"min-max EUR"` solo cuando la API trae **ambos** límites; si no,
  `null`. En IT/ES muchas ofertas no publican salario.
- `remote` es siempre `null`: la API de búsqueda de Adzuna no expone campo de
  trabajo remoto — nunca se infiere.
- Errores: JSON a stderr (`{"error": "...", "code": "..."}`) y exit 1; falta de
  credenciales: exit 2.

Los formatos `table` y `plain` son resúmenes para lectura humana; pueden omitir
campos largos como `description` y no sustituyen al JSON completo del contrato
(la tabla incluye `SALARY`).

## Tests

```bash
cd .agents/skills/adzuna-search/cli && bun test
```

Los tests de parsing corren contra `tests/fixtures/search-it.json` — una
respuesta real recortada de la API (portal `it`, 3 resultados: con y sin
salario) — y no tocan la red.
