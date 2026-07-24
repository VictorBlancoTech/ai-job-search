---
name: remoteok-search
version: 1.0.0
description: >
  Use this skill to search global remote job listings through Remote OK's public
  JSON API, especially remote software, engineering, data, AI, and operations
  roles. Trigger phrases: remote jobs, remote developer jobs, find a remote job,
  search remote vacancies, or look up Remote OK openings.
context: fork
enabled: true  # set to false to keep this portal installed but have /job-scrape skip it
allowed-tools: Bash(bun run .agents/skills/remoteok-search/cli/src/cli.ts *)
---

# remoteok-search - skill de portal remoto global

Busca ofertas de empleo remoto a traves de la **[API publica de Remote
OK](https://remoteok.com/api)**. No requiere credenciales ni API key y el CLI no
tiene dependencias de runtime: solo necesita `bun`.

## Alcance, User-Agent y uso responsable

- La API es global y todos los resultados se marcan como `remote: true`.
- El CLI envia el User-Agent identificativo requerido:
  `ai-job-search/1.0 (personal use, github.com/VictorBlancoTech/ai-job-search)`.
- Respeta el `Crawl-delay` y las condiciones de uso de Remote OK: uso personal,
  fair use, sin polling agresivo ni scraping masivo. La API publica puede
  suspender el acceso si se ignoran sus limites o terminos.
- Remote OK exige atribucion: cuando se muestran datos, menciona **Remote OK** y
  conserva un enlace follow a la oferta o a
  `https://remoteok.com/remote-jobs`. Los formatos `table` y `plain` incluyen la
  atribucion; cada resultado JSON conserva `portal: "remoteok"` y su URL.

## Filtros locales

Remote OK no ofrece un contrato fiable de busqueda server-side, por lo que el
CLI siempre descarga `https://remoteok.com/api` y filtra localmente:

- `--query` / `-q` se normaliza sin distinguir mayusculas ni diacriticos y se
  tokeniza como palabras completas. Todos los tokens deben aparecer, combinando
  `position`, `company`, `tags`, descripcion sin HTML y `location`; una busqueda
  `care` no coincide con `Healthcare`.
- `--tag` exige igualdad exacta del tag despues de normalizar mayusculas,
  diacriticos y espacios; no es una coincidencia por substring.
- `--limit` se aplica despues de ambos filtros.
- El alcance geografico es global; cuando una oferta no trae ubicacion, el
  resultado usa `Worldwide`.

## Comando y flags

```bash
bun run .agents/skills/remoteok-search/cli/src/cli.ts search [flags]
```

- `--query <texto>` / `-q` - consulta opcional con AND de tokens completos.
- `--tag <tag>` - tag opcional con igualdad normalizada exacta.
- `--limit <n>` / `-n` - entero entre `1` y `100`, aplicado despues de filtrar.
  Default `50`.
- `--format json|table|plain` - default `json`; cualquier otro valor es invalido.

Ejemplos:

```bash
# AI automation, salida JSON completa para el pipeline
bun run .agents/skills/remoteok-search/cli/src/cli.ts search -q "AI automation" --limit 5

# Tags exactos, resumen legible
bun run .agents/skills/remoteok-search/cli/src/cli.ts search --tag "react native" --format table
```

## Contrato JSON

`--format json` devuelve:

```json
{
  "meta": { "portal": "remoteok", "count": 1, "query": "AI automation", "location": null },
  "results": [
    {
      "id": "1135014",
      "portal": "remoteok",
      "title": "React Native Engineer",
      "company": "HelpBnk",
      "location": "Worldwide",
      "url": "https://remoteOK.com/remote-jobs/remote-react-native-engineer-helpbnk-1135014",
      "date": "2026-07-18",
      "description": "HTML stripped string",
      "remote": true,
      "salary": "60000-80000"
    }
  ]
}
```

- `id` es siempre un string; `date` se normaliza a `YYYY-MM-DD` solo desde un
  ISO estricto o un `Date` valido dentro de `0000..9999`, y es `null` para
  valores ausentes o invalidos.
- `description` elimina HTML, conserva saltos legibles y decodifica entidades
  HTML comunes y numericas.
- `salary` es `min-max` solo cuando ambos limites son positivos; en otro caso es
  `null`.
- `company` es `null` si falta. `location` usa `Worldwide` si falta.
- El primer elemento de la respuesta (metadatos legales) se ignora; tambien se
  ignoran entradas nulas o malformadas.
- JSON es la salida completa. `table` y `plain` son resumenes y pueden omitir
  campos largos como `description`.
- Los errores se escriben en stderr como `{ "error": "...", "code": "..." }`.
  Los argumentos invalidos terminan con exit code `2`; los fallos de API o de
  respuesta terminan con exit code `1`.

## Tests

```bash
cd .agents/skills/remoteok-search/cli
bun test
bun run typecheck
```

Los tests usan `cli/tests/fixtures/search.json`, una respuesta recortada del
endpoint publico con metadatos legales, entradas malformadas y ofertas de
ejemplo. No acceden a la red.
