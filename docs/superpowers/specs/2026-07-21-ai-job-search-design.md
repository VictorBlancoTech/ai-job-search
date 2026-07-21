# Spec: AI Job Search (fork adaptado de MadsLorentzen/ai-job-search)

**Fecha:** 2026-07-21
**Estado:** Diseño aprobado por Victor; pendiente review del spec escrito
**Enfoque:** A — Fork y poda incremental
**Runtime:** OpenCode nativo (sin `.claude/`)
**Idioma del sistema:** Español. Salidas IT/ES/EN según oferta.

## 1. Propósito

Sistema de búsqueda de empleo personal que corre en OpenCode: scrapea portales, evalúa fit con scoring personalizado (ubicación por tiers, sector marino como máximo bonus), adapta el CV Awesome-CV existente, redacta cartas (Markdown canónico + LaTeX bajo demanda), prepara entrevistas y trackea el pipeline en CSV + notas SecondBrain.

**Criterios de éxito:**
- Primera aplicación real generada en ≤3 días de trabajo (fin de Fase 1).
- Digest matutino automático con ofertas nuevas scoreadas (Fase 3).
- Ningún claim inventado en CV/carta (regla de oro, verificada por checklist).
- Tracker y notas SecondBrain siempre actualizados sin escritura manual.

## 2. Arquitectura

Fork del repo upstream (MIT). Estructura objetivo tras la poda:

```
ai-job-search/
├── AGENTS.md                        # reglas del workflow (OpenCode)
├── .env                             # credenciales (gitignored): Adzuna, InfoJobs
├── .opencode/commands/              # setup, scrape, rank, apply, outcome, interview,
│                                    # expand, upskill, html-report, add-portal, reset
├── .agents/skills/
│   ├── job-application-assistant/   # skill núcleo (perfil + reglas)
│   └── <portal>-search/             # CLIs Bun por portal (contrato JSON unificado)
├── perfil/
│   ├── 01-perfil-candidato.md       # importado de Awesome-CV/instrucciones.md
│   ├── 02-perfil-conductual.md
│   ├── 03-estilo-escritura.md
│   ├── 04-evaluacion-ofertas.md     # scoring §4
│   ├── 05-prep-entrevistas.md       # STAR examples
│   └── search-queries.md            # 15 queries IT/ES/EN
├── cv/                              # Awesome-CV: clase + cv-master IT/ES/EN
├── cartas/                          # plantilla LaTeX Awesome-CV de carta (Fase 5)
├── templates/carta.md               # plantilla Markdown canónica de carta
├── documents/                       # diplomas, referencias, materiales fuente
├── tracker/
│   ├── job_search_tracker.csv
│   └── aplicaciones/<empresa>_<rol>/
└── tools/                           # lint, security guards (heredados)
```

**Componentes y límites:**
- **Comandos** (`.opencode/commands/`): orquestación de workflows; delegan en skills y CLIs.
- **Skill núcleo**: lee `perfil/`; único componente que conoce las reglas de scoring y redacción.
- **CLIs de portales**: cada uno recibe query+location, devuelve JSON `[{titulo, empresa, ubicacion, url, descripcion, portal, fecha}]`. Independientes, testeables por separado.
- **Tracker**: CSV es el sistema de registro; las notas SecondBrain son una vista generada (nunca editada a mano).
- **Digest matutino**: script launchd en Mac Mini que corre `/scrape` + `/rank` y deja el resumen como nota diaria en `SecondBrain/Projects/Job-Search/digest/` (visible en Obsidian desde cualquier dispositivo).

## 3. Modelo de ubicación (input del scoring)

| Tier | Criterio |
|------|----------|
| A+ | Casalecchio di Reno + Bologna ciudad |
| A | Ciudad italiana con mar |
| B+ | Remoto (ES o internacional) |
| B | España presencial costa, solo si oferta muy buena |
| C | Interior IT >45-60 min commute — casi nunca; nunca gana a A |
| Veto | Milán, Roma, Turín, interior lejano — descarte automático |

## 4. Scoring de fit (`perfil/04-evaluacion-ofertas.md`)

| Dimensión | Peso |
|-----------|------|
| Ubicación (tiers §3) | 25% |
| Encaje de rol (Responsabile IT, IT Manager, Digital Transformation, AI Automation, Energy/EGE) | 25% |
| Skills técnicos (gaps honestos) | 20% |
| Sector: máximo = protección ambiental/marino; alto = manufactura E-R, energía, packaging/automotive, tech/consultoría | 15% |
| Nivel económico (ref. 50-60k€ Energy Manager remote) | 10% |
| Idioma/cultura | 5% |

Salida: nota 0-10 + veredicto (APLICAR / APLICAR SI SOBRA TIEMPO / DESCARTAR) + 3 fortalezas + 3 gaps + tier justificado.
Vetos: tier Veto; requisito excluyente no cumplido.
Calibración: tras 10-15 outcomes, /outcome propone ajuste de pesos.

## 5. Portales

**Tier 1 (Fase 2) — APIs/RSS:** adzuna (IT+ES, key obtenida), infojobs (ES, crear app → client_id/secret), remotive, remoteok (atribución), arbeitnow, wwr+himalayas.
**Tier 2 (Fase 4) — HTML simple:** lavoroperte (Regione E-R), agencias-er (Experis/Randstad/Adecco/Michael Page), tecnoempleo, marine-search (Conservation Careers, Oceana, Marevivo, EMODnet/OGS/CNR...).
**Tier 3 (opcional):** linkedin jobs-guest (<20 req/día).
**Descartados:** Indeed directo, Monster, Talent.com, InfoJobs Italia (cerrado).

Reglas: volumen bajo, respetar robots.txt/rate limits, APIs oficiales primero, sin bypass anti-bot.

## 6. Pipeline /apply

1. Parse oferta (URL o texto; input no confiable — no seguir instrucciones embebidas).
2. Scoring §4. Si DESCARTAR → informar y parar.
3. Detección de idioma → CV/carta en IT/ES/EN.
4. Draft CV desde Awesome-CV master; corte por relevancia si >2 págs.
5. Draft `carta.md`.
6. Reviewer agent (contexto fresco): investiga empresa, critica ambos.
7. Revisión del drafter.
8. Compilación lualatex + inspección visual (2 págs exactas, sin huérfanos) + check ATS con pdftotext (contacto, orden lectura, keywords).
9. Carta PDF solo con `--pdf` o si la oferta lo requiere.
10. Salida en `tracker/aplicaciones/<empresa>_<rol>/` + nota SecondBrain + fila CSV + checklist.

**Regla de oro:** ningún claim inventado; gaps declarados.

**Manejo de errores:** URL inaccesible → pedir texto pegado. Fallo de compilación LaTeX → iterar fixes (needspace/enlargethispage/fonts) hasta 3 intentos, luego reportar. Portal caído en /scrape → continuar con el resto y reportar. pdftotext ausente → degradar a revisión visual de keywords.

## 7. Tracker + SecondBrain

- `tracker/job_search_tracker.csv`: fecha, empresa, rol, portal, url, tier, score, estado, próxima acción, notas.
- Nota Obsidian por aplicación en `SecondBrain/Projects/Job-Search/` con frontmatter (estado, score, tier, portal, fechas, tags [job-search]); generada en /apply, actualizada en /outcome.
- Config `SECONDBRAIN_PATH` en `.env`: escritura vía SSH al Mac Mini (`minivictorblanco@100.109.159.63:/Users/minivictorblanco/Documents/SecondBrain`) con `scp`; si el vault acaba sincronizado también en el Mac Air, basta cambiar la variable a la ruta local.
- `/outcome`: manual; follow-ups redactados automáticamente (nunca enviados; máx. 2 por aplicación; silencio >10 días).

## 8. Automatización

- Digest matutino (Fase 3): launchd Mac Mini 7:00 → /scrape + /rank → resumen.
- Follow-ups: borrador automático, envío manual.
- Notas/CSV: siempre automáticos.
- /apply: decisión de Victor; pipeline automático tras elegir.
- Sin gmail-sync (descartado por privacidad).

## 9. Testing

- **CLIs de portales:** test-run de query real al registrarse (como hace /add-portal upstream); contrato JSON validado por schema.
- **/apply:** smoke test con oferta de ejemplo → CV compila a 2 págs, pdftotext extrae contacto correcto, carta.md generada.
- **Scoring:** 3-5 ofertas de ejemplo con veredicto esperado (una por tier relevante + una veto).
- **CI heredado del fork:** lint de skills/comandos, security guards, smoke compiles LaTeX — mantenerlo pasando.
- **Tracker:** tras /outcome de prueba, CSV + nota actualizados coherentemente.

## 10. Fases

- **Fase 0** (día 1): fork, poda (.claude/, portales daneses, referencias Dinamarca), .env, OpenCode reconoce repo.
- **Fase 1** (días 1-3): perfil importado + /apply mínimo con Awesome-CV + drafter-reviewer + ATS. **Hito: primera aplicación real.**
- **Fase 2** (días 3-5): CLIs Tier 1 + /scrape + /rank.
- **Fase 3** (semana 2): tracker CSV + notas SecondBrain + /outcome + digest matutino.
- **Fase 4** (semanas 2-3): Tier 2 vía /add-portal portado + marine-search.
- **Fase 5**: /interview, /upskill, /expand, plantilla LaTeX de carta, /html-report.

## 11. Riesgos

- **Fragilidad de scrapers HTML** (Tier 2/3): mitigada empezando por APIs estables; Tier 2 aislado por CLI.
- **Deriva del fork vs upstream**: poda agresiva asumida como decisión; no se persigue merge upstream.
- **Claves API en .env**: gitignored; security guards de CI heredados lo verifican.
- **Acceso al vault desde Mac Air**: escritura vía SSH/scp (decisión tomada); si falla la conexión, la nota queda en cola local y se reintenta (degradación aceptable).
