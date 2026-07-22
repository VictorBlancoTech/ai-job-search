---
name: remotive-search
version: 1.0.0
description: >
  Use this skill to search live global remote job listings through Remotive's
  public API, especially remote software, data, engineering, and AI consultant
  roles. Trigger phrases: remote jobs, remote developer jobs, AI consultant
  jobs, find a remote job, search remote vacancies, or look up remote openings.
context: fork
enabled: true  # set to false to keep this portal installed but have /scrape skip it
allowed-tools: Bash(bun run .agents/skills/remotive-search/cli/src/cli.ts *)
---

# remotive-search - Skill de portal remoto global

Busca ofertas de empleo remoto a traves de la **[API publica de
Remotive](https://remotive.com/api-documentation)**. No requiere credenciales ni
API key y el CLI no tiene dependencias de runtime: solo necesita `bun`.

## Alcance y uso responsable

- La API es global y todos sus resultados se marcan como `remote: true`.
- No hay filtro de pais o localizacion en este CLI. El filtrado geografico se
  realiza en `/rank` usando `candidate_required_location`.
- Es una API publica para compartir ofertas, no una fuente para scraping masivo.
  Respeta los terminos de Remotive y su uso razonable: la documentacion recomienda
  consultar los datos como maximo unas cuatro veces al dia porque cambian poco.
- Al mostrar resultados fuera del pipeline, conserva el enlace a la oferta y
  menciona Remotive como fuente.

## Filtros locales

La API publica alojada puede ignorar `search`, `category` y `limit` en algunas
respuestas. El CLI sigue enviando esos parametros para aprovechar una futura
version del endpoint, pero aplica siempre la correccion localmente:

- `--query` busca sin distinguir mayusculas en titulo, empresa, descripcion sin
  HTML, categoria y localizacion; todas las palabras deben estar presentes.
- `--category` exige coincidencia sin distinguir mayusculas con la categoria de
  la oferta.
- `--limit` se aplica despues de los filtros.

Por tanto, una busqueda correcta puede descargar primero la pagina completa de
la API y filtrar despues; el coste de red no se reduce aunque el resultado final
si este limitado.

## Comando

```bash
bun run .agents/skills/remotive-search/cli/src/cli.ts search [flags]
```

Flags:

- `--query <texto>` / `-q` - busqueda opcional de palabras clave en la API.
- `--limit <n>` / `-n` - resultados solicitados, entero entre `1` y `100`. Default `50`.
- `--category <texto>` - categoria de Remotive, pasada a la API cuando se proporciona.
- `--format json|table|plain` - default `json`.

Ejemplos:

```bash
# Ofertas de AI consultant, salida completa para el pipeline
bun run .agents/skills/remotive-search/cli/src/cli.ts search -q "AI consultant" --limit 5

# Ofertas de desarrollo remoto, resumen legible
bun run .agents/skills/remotive-search/cli/src/cli.ts search --category "Software Development" --format table
```

## Contrato JSON

`--format json` es la salida completa y devuelve:

```json
{
  "meta": { "portal": "remotive", "count": 2, "query": "AI consultant", "location": null },
  "results": [
    {
      "id": "2091069",
      "portal": "remotive",
      "title": "Patient Care Specialist",
      "company": "STATLINX",
      "location": "USA",
      "url": "https://remotive.com/remote-jobs/medical/patient-care-specialist-2091069",
      "date": "2026-07-16",
      "description": "HTML stripped string",
      "remote": true,
      "salary": "$36k"
    }
  ]
}
```

- `id` siempre es un string y `date` es `publication_date` truncado a `YYYY-MM-DD`.
- `description` elimina HTML y decodifica entidades comunes y numericas.
- `company`, `location`, `date` y `salary` son `null` cuando faltan.
- `table` y `plain` son resumenes para lectura humana y pueden omitir la
  descripcion; no sustituyen al JSON completo.
- Todos los errores se escriben en stderr como `{ "error": "...", "code": "..." }`.
  Los argumentos invalidos terminan con exit code `2`; un fallo de API con `1`.

## Tests

```bash
cd .agents/skills/remotive-search/cli
bun test
bun run typecheck
```

Los tests de parsing usan `cli/tests/fixtures/search.json`, una respuesta real de
la API recortada a tres ofertas y sin datos personales.
