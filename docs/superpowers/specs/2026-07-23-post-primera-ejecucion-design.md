# Spec: Mejoras post-primera-ejecución del pipeline ai-job-search

**Fecha:** 2026-07-23
**Estado:** Aprobado por Victor tras brainstorming; pendiente plan de implementación
**Enfoque:** A — Incremental quirúrgico (sin refactor de lo que ya funciona)
**Trigger:** Revisión post-mortem de la primera ejecución E2E (135 ofertas rankeadas, 2 aplicaciones ejecutadas de 10 APLICAR)

---

## 1. Contexto y motivación

La primera ejecución E2E funcionó (scrape → rank → apply), pero reveló 5 fricciones:

1. **8 de 10 APLICAR no se ejecutaron** — el usuario descartó al abrir las páginas por dos razones que el scorer no capturó: requisitos excluyentes escondidos (Unipol pedía master con nota) y ATS hostiles que exigen re-meter el CV a mano (Workday, Taleo).
2. **Batching manual** — el usuario tuvo que pedir el rank en "grupos de 50" manualmente. El comando no escala solo.
3. **Inglés sin penalizar** — ofertas en inglés ganaron puestos APLICAR sin matiz.
4. **Tier A abierto** — la lista de ciudades costeras italianas era abierta ("..."), generando inconsistencias.
5. **Cobertura de portales insuficiente** — 135 ofertas no son suficiente funnel semanal.

**Decisión de diseño:** cambios quirúrgicos en archivos existentes + 3 skills nuevas + tooling de batching. No se reescribe `/job-rank` ni el scorer LLM.

---

## 2. Cambios por componente

### 2.1 Scoring — `perfil/04-evaluacion-ofertas.md`

**2.1.1 Tiers de ubicación cerrados** (sustituir la línea 22 y 24):

| Tier | Criterio | Score |
|------|----------|-------|
| A+ | Casalecchio di Reno + Bologna ciudad | 10 |
| A | Italia costa (lista cerrada de 23): Nápoles, Palermo, Génova, Bari, Catania, Venecia, Mesina, Trieste, Tarento, Reggio Calabria, Rávena, Livorno, Rímini, Cagliari, Salerno, Latina, Sássari, Pescara, Siracusa, Ancona, Lecce, La Spezia, Pisa | 9 |
| B+ | Remoto (España, Italia o internacional) | 8 |
| B | España costa (lista cerrada de 24): Barcelona, Valencia, Málaga, Palma, Las Palmas, Alicante, Bilbao, Vigo, L'Hospitalet, Gijón, La Coruña, Elche, Badalona, Cartagena, Jerez, Santa Cruz Tenerife, Almería, San Sebastián, Castellón, Santander, Marbella, Tarragona, Huelva, Mataró | 6 |
| C | Interior italiano >45-60 min commute | 3 |
| VETO | Milán, Roma, Turín, interior lejano | 0 |

Notas aplicadas:
- L'Hospitalet, Badalona, Mataró, Elche cuentan como área metropolitana costera (B).
- Las Palmas y Santa Cruz Tenerife son B por mar, aunque en la práctica implican remoto.

**2.1.2 Penalización suave por idioma inglés** (nueva subsección tras "Bonus de sector"):

> Si la oferta está redactada en inglés Y el puesto NO requiere inglés como skill central: **-1.5 al score final**. Exenciones: roles explícitamente internacionales (remote EMEA, EU-wide), o que piden inglés C1+ como requisito — en esos casos el inglés es skill, no fricción.

**2.1.3 Vetos automáticos ampliados** (sustituir la lista de la sección "Vetos automáticos"):

1. Ubicación tier VETO.
2. Requisito excluyente no cumplido:
   - Laurea en ingeniería completada obligatoria.
   - Master/laurea con nota mínima (110/110, "con lode", "votazione minima X/110").
   - Certificaciones profesionales obligatorias que Victor no posee (PMP, ITIL Expert, CISSP, CISM).
   - Años excluyentes en tecnología específica (>5 años en tool X que Victor no tiene).
3. Presencial en ciudad sin mar a >1h de Casalecchio con oferta no excepcional.
4. Idioma: italiano "madrelingua" requerido en oferta no redactada en italiano (señal de outsourcing encubierto).

**2.1.4 Bonus por email directo** (nueva regla tras "Nivel económico"):

> Si la descripción incluye email directo de contacto (extraído por regex en scraping), anotar en Notas "aplicación directa por email — baja fricción" y **+0.5 al score final** (cap 10). Incentiva canal de baja fricción vs ATS hostil.

### 2.2 Batching paralelo — `/job-rank` + tools

**2.2.1 `tools/build_rank_batches.py`** — añadir flag `--parallel N` (default 3):
- Genera N archivos de prompt en `job_scraper/rank_runs/batch-<ts>-<i>.md`, cada uno con ≤50 ofertas.
- Devuelve manifiesto JSON con paths y conteos para que el comando invoque N subagentes en una sola llamada Task.

**2.2.2 `.opencode/commands/job-rank.md`** — documentar el flujo:
- Para N>25 ofertas, el comando invoca 3 subagentes en paralelo vía Task tool.
- Cada subagente procesa su batch y escribe `rank- partial-<i>.json`.
- Al completar los 3, el comando ejecuta `tools/aggregate_rank.py` y devuelve shortlist consolidado.

**2.2.3 `tools/aggregate_rank.py`** — validación None-safe:
- Si una entrada carece de `title`, `location` o `score`, moverla a `failures` con código `RANK_FIELD_NULL` y razón descriptiva. No romper el agregado.

**2.2.4 `tools/rank_safety.py`** — nuevo guardrail:
- Si >30% de una wave falla (`RANK_FAILED` o `RANK_FIELD_NULL`) **y hay ≥3 candidatos**, abortar agregación con `SystemExit(2)` y devolver error. Con menos de 3 candidatos, el threshold no aplica (evita aborts espurios en runs tiny). Evita shortlists con datos parciales.

### 2.3 Scraper — descripción completa + ATS/email

**2.3.1 Skills existentes (`adzuna-search`, `linkedin-search`, `infojobs-search`, `freehire-search`):**
- Verificar que `descripcion` no esté truncada. Si hay límite <5000 chars, subirlo.
- Añadir a la salida JSON dos campos nuevos:
  - `email_contacto`: string o null. Regex `[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}` sobre la descripción.
  - `ats_hostil`: boolean. True si la URL de aplicación contiene alguno de estos dominios (siempre requieren cuenta/formulario largo): `workday.com`, `myworkdayjobs.com`, `taleo.net`, `successfactors.com`, `icims.com`, `phenompeople.com`, `smartrecruiters.com`, `jobvite.com`, `oraclecloud.com` (Oracle HCM), `sap.com` (SAP SF). Greenhouse y Lever NO se marcan: a veces permiten aplicar sin cuenta.

**2.3.2 `tools/security_guards.py`** — nuevas funciones:
- `detect_ats_hostil(url: str) -> bool`
- `extract_contact_email(description: str) -> Optional[str]`
- Tests en `tests/test_security_guards.py` cubriendo: URL limpia, Workday, Taleo, email simple, emails múltiples (devuelve el primero), sin email.

### 2.4 Skills nuevas

**2.4.1 `jooble-search`** (`.agents/skills/jooble-search/`):
- API pública con key. Variable `JOOBLE_API_KEY` en `.env`.
- CLI Bun con contrato JSON unificado (mismo schema que `adzuna-search`).
- Endpoint: `https://jooble.org/api/<KEY>`, POST con `{keywords, location, page}`.

**2.4.2 `careerjet-search`** (`.agents/skills/careerjet-search/`):
- API pública sin key. Endpoint: `https://public.api.careerjet.net/search?locale_code=it_IT&keywords=...&location=...`
- CLI Bun estándar.

**2.4.3 `jsearch-search`** (`.agents/skills/jsearch-search/`):
- API freemium OpenWebNinja. Variable `JSEARCH_API_KEY` en `.env` (key provista por Victor el 2026-07-23).
- Endpoint: `https://api.openwebninja.com/jsearch/search`, header `X-API-Key`.
- **Fase de evaluación:** antes de activar en `/job-scrape`, correr 5 queries de prueba (`AI consultant Milan`, `IT Manager Bologna`, `Digital Transformation Barcelona`, `Energy Manager remote`, `Responsabile IT`) y comparar overlap con `latest.json`:
  - Si >60% duplicados con LinkedIn/Adzuna → dejar en modo `evaluación` (no activar).
  - Si aporta >20% ofertas nuevas y relevantes → activar y evaluar plan de pago con Victor.

### 2.5 Queries nuevas — `perfil/search-queries.md`

**Italiano (+5):**
- IT Demand Planner
- IT Infrastructure Manager
- Responsabile Sicurezza IT
- IT Operations Manager
- Head of Digital

**Español (+4):**
- IT Manager
- Responsable Sistemas
- Consultor estrategia tecnológica
- Digital Operations Manager

**Inglés (+3):**
- IT Strategy Consultant
- Technology Advisor
- Digital Transformation Consultant

**Ubicaciones:** las 47 ciudades costeras se pasan como filtro `location` a Adzuna, InfoJobs, Jooble, Careerjet. LinkedIn sigue con su propio filtro geográfico.

### 2.6 Limpieza y commits

- Borrar `EOF` (raíz, archivo vacío).
- Commitear archivos pendientes: `tools/` nuevos, `tests/` nuevos, `ops/`, comandos renombrados `job-*.md`, skills modificados, AGENTS.md, spec actual.
- **PMI Manifatturiera → DESCARTAR y limpiar** (decisión Victor 2026-07-23): oferta huérfana del 22 julio, sin PDF compilado ni tracker ni rank. Acciones:
  - Añadir fila en `tracker/job_search_tracker.csv` con `estado=discarded`, `notas="Oferta huérfana — CV/carta generados el 2026-07-22 pero nunca compilados ni aplicados. Descartada en limpieza post-primera-ejecución."`
  - Borrar `cv/victor_pmi-manifatturiera_responsabile-it.tex`, la subcarpeta `cv/victor_pmi-manifatturiera_responsabile-it/` y `tracker/borradores/carta_pmi-manifatturiera_responsabile-it.md`.

---

## 3. Criterios de éxito verificables

1. `pytest tests/` → 100% verde (mínimo 5 tests nuevos: ATS detector, email extractor, agregador None-safe, rank_safety 30% threshold, build_rank_batches parallel flag).
2. `/job-rank` con 100 ofertas sintéticas → completa sin intervención manual, 3 subagentes en paralelo, shortlist consolidado.
3. `lint_skills.py` pasa con las 3 skills nuevas.
4. `python3 tools/security_guards.py --check .` → sin secretos nuevos commiteados.
5. Simulación de scoring sobre 5 ofertas en inglés → verificar -1.5 aplicado correctamente.
6. `git status` limpio al final (salvo artefactos gitignored).

---

## 4. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|--------|--------------|------------|
| JSearch freemium agota cuota en pruebas | Media | Limitar a 5 queries evaluación, contar requests |
| Lista 47 ciudades genera falsos positivos tier A | Baja | Tier A solo si match exacto de ciudad (no provincia); tests unitarios |
| Penalización inglés -1.5 descarta ofertas buenas | Baja | Exención para roles internacionales; calibración tras 10 aplicaciones |
| 3 subagentes paralelos saturan rate limits | Media | Retry con backoff; si 2/3 waves fallan, abortar |
| Skills Jooble/Careerjet devuelven schema inconsistente | Media | Validador estricto + `lint_skills.py` debe pasar |

---

## 5. Fuera de alcance (YAGNI)

- Refactor de `/job-rank` a pipeline Python puro (enfoque B descartado).
- UI/web dashboard — el CSV + Obsidian bastan.
- Scraping de portales sin API pública (Indeed directo, Glassdoor) — violaría ToS.
- Aplicación automática (auto-submit de formularios) — requiere supervisión humana por la regla de oro "ningún claim inventado".

---

## 6. Calibración futura

Tras 10-15 aplicaciones nuevas con este sistema, revisar:
- ¿El -1.5 de inglés está calibrado o es demasiado/poco?
- ¿El bonus +0.5 por email directo está generando falsos positivos (emails de noreply)?
- ¿Las ciudades tier B españolas están generando APLICAR que luego se descartan por distancia real?
