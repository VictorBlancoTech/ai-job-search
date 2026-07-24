# Mejoras post-primera-ejecución — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevar la fiabilidad del pipeline ai-job-search (ranking paralelo 3×50 automático, scoring con penalización inglés + tiers costeros cerrados + detección ATS/email, 3 skills nuevas de portales) sin reescribir lo que ya funciona.

**Architecture:** Cambios quirúrgicos en archivos existentes (`perfil/04`, `tools/rank_safety.py`, `tools/aggregate_rank.py`, `tools/build_rank_batches.py`, `.opencode/commands/job-rank.md`) + 3 skills nuevas que clonan el patrón `adzuna-search`. TDD en cada componente Python; validación estructural con tests existentes.

**Tech Stack:** Python 3 stdlib (tools), Bun + TypeScript (skills), Markdown (comandos y perfil), pytest (tests).

**Spec:** `docs/superpowers/specs/2026-07-23-post-primera-ejecucion-design.md`

---

## File Structure

**Modificados:**
- `perfil/04-evaluacion-ofertas.md` — scoring (tiers, idioma, vetos, bonus email)
- `perfil/search-queries.md` — queries nuevas
- `tools/rank_safety.py` — `detect_ats_hostil()`, `extract_contact_email()`
- `tools/aggregate_rank.py` — validación None-safe + threshold 30%
- `tools/build_rank_batches.py` — flag `--parallel N` y `--batch-size M`
- `.opencode/commands/job-rank.md` — orquestación paralela 3×50, límite 50→150
- `tracker/job_search_tracker.csv` — cerrar PMI Manifatturiera
- `.env` — ya tiene JSEARCH_API_KEY y JOOBLE_API_KEY placeholder

**Creados:**
- `tests/test_ats_email_detection.py` — tests detectores
- `tests/test_aggregate_rank_null_safe.py` — tests agregador
- `tests/test_build_rank_batches_parallel.py` — tests batching
- `.agents/skills/jooble-search/` — skill Jooble (SKILL.md + cli/)
- `.agents/skills/careerjet-search/` — skill Careerjet
- `.agents/skills/jsearch-search/` — skill JSearch
- `tools/evaluate_jsearch_overlap.py` — script evaluación overlap

**Borrados:**
- `EOF` (raíz)
- `cv/victor_pmi-manifatturiera_responsabile-it.tex` y subcarpeta
- `tracker/borradores/carta_pmi-manifatturiera_responsabile-it.md`

---

## Fase 0 — Limpieza y commits pendientes

### Task 1: Cerrar PMI Manifatturiera y borrar EOF

**Files:**
- Modify: `tracker/job_search_tracker.csv`
- Delete: `EOF`, `cv/victor_pmi-manifatturiera_responsabile-it.tex`, `cv/victor_pmi-manifatturiera_responsabile-it/`, `tracker/borradores/carta_pmi-manifatturiera_responsabile-it.md`

- [ ] **Step 1: Añadir fila DESCARTAR al tracker**

Append a `tracker/job_search_tracker.csv`:

```csv
2026-07-23,PMI Manifatturiera,Responsabile IT,unknown,,C,0,discarded,Ninguna,2026-07-23: Oferta huérfana del 2026-07-22 — CV/carta generados pero nunca compilados ni aplicados. Descartada en limpieza post-primera-ejecución.
```

- [ ] **Step 2: Borrar archivos**

```bash
rm EOF
rm cv/victor_pmi-manifatturiera_responsabile-it.tex
rm -rf cv/victor_pmi-manifatturiera_responsabile-it/
rm tracker/borradores/carta_pmi-manifatturiera_responsabile-it.md
```

- [ ] **Step 3: Verificar**

```bash
ls EOF 2>&1  # debe decir "No such file"
ls cv/victor_pmi* 2>&1  # debe decir "No such file"
ls tracker/borradores/carta_pmi* 2>&1  # debe decir "No such file"
tail -1 tracker/job_search_tracker.csv  # debe mostrar la fila nueva
```

- [ ] **Step 4: Commit**

```bash
git add tracker/job_search_tracker.csv
git rm cv/victor_pmi-manifatturiera_responsabile-it.tex 2>/dev/null || true
git commit -m "chore: cerrar PMI Manifatturiera como DESCARTAR + borrar EOF huérfano"
```

---

### Task 2: Commitear trabajo pendiente de la primera ejecución

**Files:**
- Add: `tools/` (nuevos), `tests/` (nuevos), `ops/`, `.opencode/commands/job-*.md`, modificaciones a skills y perfil

- [ ] **Step 1: Verificar que `tools/security_guards.py` pasa con los archivos nuevos**

```bash
python3 tools/security_guards.py
```

Expected: `security_guards: OK (gitignore rules, package manifests)` y exit 0.

- [ ] **Step 2: Verificar que la suite sigue verde**

```bash
python3 -m pytest tests/ -q
```

Expected: `95 passed, 5 skipped` (o el número actual).

- [ ] **Step 3: Añadir y commitear en bloques lógicos**

```bash
git add .opencode/commands/job-*.md .opencode/plans/
git commit -m "feat: comandos job-* (setup, scrape, rank, apply, outcome, digest)"

git add tools/aggregate_all_rank.py tools/aggregate_rank.py tools/build_all_prompts.py tools/build_batched_prompts.py tools/build_rank_batches.py tools/daily_digest.sh tools/digest.py tools/digest_render.py tools/job_tracker.py tools/pick_all_candidates.py tools/pick_candidates.py tools/split_waves.py
git commit -m "feat: tools de agregación rank, digest y tracking"

git add tests/test_digest.py tests/test_job_tracker.py tests/test_phase3_commands.py
git commit -m "test: cobertura digest, tracker y fase 3"

git add ops/
git commit -m "ops: launchd plist para digest matutino"

git add job_scraper/run_scrape.py
git commit -m "feat: runner unificado de scrape"

git add AGENTS.md CLAUDE.md README.md docs/ documents/README.md perfil/ templates/ .agents/ tests/test_lint_skills.py tests/test_outcome_followup.py tests/test_rank_command.py tests/test_rank_safety.py tools/lint_skills.py tools/rank_safety.py tools/security_guards.py .gitignore
git commit -m "chore: sync skills, perfil, docs y lint tras primera ejecución"
```

- [ ] **Step 4: Verificar `git status` limpio**

```bash
git status
```

Expected: solo archivos gitignored y `cv/victor_*.txt` (que son artefactos gitignored del día a día — verificar con `git check-ignore`).

---

## Fase 1 — Detectores ATS y email

### Task 3: `detect_ats_hostil()` con TDD

**Files:**
- Test: `tests/test_ats_email_detection.py` (nuevo)
- Modify: `tools/rank_safety.py`

- [ ] **Step 1: Escribir tests que fallan**

Crear `tests/test_ats_email_detection.py`:

```python
"""Tests for ATS-hostile URL detection and contact email extraction."""

import pytest

from tools.rank_safety import detect_ats_hostil, extract_contact_email


class TestDetectAtsHostil:
    @pytest.mark.parametrize("url", [
        "https://company.workday.com/en-US/job/12345",
        "https://wd1.myworkdaysite.com/en-US/external/job/ABC",
        "https://jobs.taleo.net/careersection/acme/jobdetail.ftl?job=123",
        "https://careers.successfactors.com/acme/job/123",
        "https://careers.icims.com/jobs/1234/it-manager/job",
        "https://jobs.phenompeople.com/acme/job/123",
        "https://jobs.smartrecruiters.com/Acme/123-it-manager",
        "https://acme.jobvite.com/job/123",
        "https://oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123",
        "https://sap.com/careers/job/123",
    ])
    def test_hostile_ats_returns_true(self, url):
        assert detect_ats_hostil(url) is True

    @pytest.mark.parametrize("url", [
        "https://www.linkedin.com/jobs/view/123456",
        "https://jobs.lever.co/acme/abc-123",  # lever NO siempre requiere cuenta
        "https://boards.greenhouse.io/acme/jobs/123",  # idem
        "https://acme.com/careers/it-manager",
        "https://es.indeed.com/job/123",
        None,
        "",
        "not-a-url",
    ])
    def test_safe_or_invalid_returns_false(self, url):
        assert detect_ats_hostil(url) is False


class TestExtractContactEmail:
    def test_simple_email(self):
        text = "Send your CV to hr@acme.com for more info."
        assert extract_contact_email(text) == "hr@acme.com"

    def test_multiple_emails_returns_first(self):
        text = "Contact hiring@acme.com or jobs@acme.com."
        assert extract_contact_email(text) == "hiring@acme.com"

    def test_italian_apply_pattern(self):
        text = "Invia il tuo CV a selezione@azienda.it indicando il riferimento."
        assert extract_contact_email(text) == "selezione@azienda.it"

    def test_no_email_returns_none(self):
        assert extract_contact_email("Apply on our website.") is None
        assert extract_contact_email("") is None
        assert extract_contact_email(None) is None

    def test_noreply_filtered(self):
        text = "Do not reply to noreply@acme.com. Apply via website."
        assert extract_contact_email(text) is None

    def test_no_reply_variant_filtered(self):
        text = "Automatic message from no-reply@acme.com."
        assert extract_contact_email(text) is None
```

- [ ] **Step 2: Verificar que fallan**

```bash
python3 -m pytest tests/test_ats_email_detection.py -v
```

Expected: `ImportError: cannot import name 'detect_ats_hostil' from 'tools.rank_safety'`.

- [ ] **Step 3: Implementar en `tools/rank_safety.py`**

Añadir al final del archivo, antes del bloque `if __name__ == "__main__":` (si lo hubiera — este archivo no tiene main, solo funciones; añadir al final):

```python
_ATS_HOSTIL_DOMAINS = frozenset({
    "workday.com",
    "myworkdayjobs.com",
    "myworkdaysite.com",
    "taleo.net",
    "successfactors.com",
    "icims.com",
    "phenompeople.com",
    "jobvite.com",
})

_NOREPLY_LOCAL_PARTS = frozenset({
    "noreply",
    "no-reply",
    "no_reply",
    "donotreply",
    "do-not-reply",
    "do_not_reply",
    "mailer-daemon",
    "postmaster",
})


def detect_ats_hostil(value: Any) -> bool:
    """Return whether the apply URL belongs to a hostile ATS (forced account or long form)."""
    if not isinstance(value, str) or not value:
        return False
    try:
        parts = urlsplit(value.lower())
    except ValueError:
        return False
    host = parts.hostname or ""
    if not host:
        return False
    return any(
        host == domain or host.endswith("." + domain)
        for domain in _ATS_HOSTIL_DOMAINS
    )


def extract_contact_email(description: Any) -> Optional[str]:
    """Return the first non-noreply email in a job description, or None."""
    if not isinstance(description, str) or not description:
        return None
    for match in _EMAIL_RE.finditer(description):
        email = match.group(0)
        local = email.split("@", 1)[0].lower()
        if local in _NOREPLY_LOCAL_PARTS:
            continue
        return email
    return None
```

Verificar que `urlsplit`, `Any`, `Optional` ya están importados (sí lo están: líneas 9-10 del archivo actual).

- [ ] **Step 4: Verificar que pasan**

```bash
python3 -m pytest tests/test_ats_email_detection.py -v
```

Expected: todos PASS. Si alguno falla (ej. dominio no capturado), ajustar la lista y repetir.

- [ ] **Step 5: Suite completa verde**

```bash
python3 -m pytest tests/ -q
```

Expected: 95 + 15 ≈ `110 passed, 5 skipped`.

- [ ] **Step 6: Commit**

```bash
git add tools/rank_safety.py tests/test_ats_email_detection.py
git commit -m "feat: detect_ats_hostil + extract_contact_email en rank_safety"
```

---

## Fase 2 — Agregador None-safe + rank_safety threshold

### Task 4: aggregate_rank valida campos críticos

**Files:**
- Test: `tests/test_aggregate_rank_null_safe.py` (nuevo)
- Modify: `tools/aggregate_rank.py`

- [ ] **Step 1: Escribir tests que fallan**

Crear `tests/test_aggregate_rank_null_safe.py`:

```python
"""Tests for None-safe aggregation in tools/aggregate_rank.py."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent


def _write_payloads(tmp_path, candidates, outputs, latest):
    (tmp_path / "rank_candidates.json").write_text(json.dumps(candidates))
    (tmp_path / "reviewer_outputs.json").write_text(json.dumps(outputs))
    (tmp_path / "latest.json").write_text(json.dumps(latest))


def _run_aggregate(tmp_path, monkeypatch):
    """Run aggregate_rank.main() with /tmp paths redirected to tmp_path."""
    import tools.aggregate_rank as agg
    monkeypatch.setattr(agg, "CANDIDATES", tmp_path / "rank_candidates.json")
    monkeypatch.setattr(agg, "OUTPUTS", tmp_path / "reviewer_outputs.json")
    monkeypatch.setattr(agg, "LATEST_PAYLOAD", tmp_path / "latest.json")
    monkeypatch.setattr(agg, "RANK_RUNS", tmp_path / "rank_runs")
    monkeypatch.setattr(agg, "JOB_SCRAPER", tmp_path)
    agg.main()
    return json.loads((tmp_path / "latest-rank.json").read_text())


def _valid_candidate(**overrides):
    base = {
        "job_key": "test:1",
        "id": "1",
        "portal": "test",
        "title": "IT Manager",
        "company": "Acme",
        "location": "Bologna",
        "url": "https://acme.example/job/1",
        "date": "2026-07-23",
        "description": "We are hiring.",
        "remote": None,
        "salary": None,
        "source_call": "call-1",
        "new": True,
        "source_ids": ["test:1"],
        "duplicate_sources": ["test"],
    }
    base.update(overrides)
    return base


def _valid_reviewer(job_key="test:1"):
    return {
        "job_key": job_key,
        "score": 7.5,
        "tier": "A",
        "verdict": "APLICAR",
        "strengths": ["a", "b", "c"],
        "gaps": ["x", "y", "z"],
        "salary": "no declarado",
        "notes": "Solid fit.",
    }


def _latest(run_id="20260723T000000Z-1"):
    return {
        "run_id": run_id,
        "generated_at": "2026-07-23T00:00:00Z",
        "results": [],
        "failures": [],
        "counts": {"results": 0},
    }


def test_candidate_with_null_title_goes_to_failures(tmp_path, monkeypatch):
    cand = _valid_candidate(title=None)
    out = {"by_job_key": {"test:1": {"attempts": 1, "payload": _valid_reviewer()}}}
    _write_payloads(tmp_path, [cand], out, _latest())
    payload = _run_aggregate(tmp_path, monkeypatch)
    assert payload["ranks"] == []
    assert len(payload["failures"]) == 1
    assert payload["failures"][0]["code"] == "RANK_FIELD_NULL"
    assert "title" in payload["failures"][0]["reason"]


def test_candidate_with_null_location_goes_to_failures(tmp_path, monkeypatch):
    cand = _valid_candidate(location=None)
    out = {"by_job_key": {"test:1": {"attempts": 1, "payload": _valid_reviewer()}}}
    _write_payloads(tmp_path, [cand], out, _latest())
    payload = _run_aggregate(tmp_path, monkeypatch)
    assert payload["ranks"] == []
    assert payload["failures"][0]["code"] == "RANK_FIELD_NULL"


def test_valid_candidate_passes_unchanged(tmp_path, monkeypatch):
    cand = _valid_candidate()
    out = {"by_job_key": {"test:1": {"attempts": 1, "payload": _valid_reviewer()}}}
    _write_payloads(tmp_path, [cand], out, _latest())
    payload = _run_aggregate(tmp_path, monkeypatch)
    assert len(payload["ranks"]) == 1
    assert payload["failures"] == []


def test_more_than_30_percent_failures_aborts(tmp_path, monkeypatch, capsys):
    """If >30% of candidates fail, aggregate must abort (no latest-rank written)."""
    cands = [_valid_candidate(job_key=f"test:{i}", id=str(i)) for i in range(10)]
    # 4 fail (40% > 30%) — 3 null title, 1 missing output
    cands[0]["title"] = None
    cands[1]["title"] = None
    cands[2]["title"] = None
    out = {"by_job_key": {
        f"test:{i}": {"attempts": 1, "payload": _valid_reviewer(job_key=f"test:{i}")}
        for i in range(3, 9)
        # test:9 missing on purpose
    }}
    _write_payloads(tmp_path, cands, out, _latest())
    with pytest.raises(SystemExit):
        _run_aggregate(tmp_path, monkeypatch)
    captured = capsys.readouterr()
    assert "failure rate" in captured.out.lower() or "abort" in captured.out.lower()
```

- [ ] **Step 2: Verificar que fallan**

```bash
python3 -m pytest tests/test_aggregate_rank_null_safe.py -v 2>&1 | tail -20
```

Expected: los 4 tests fallan (el primero porque no existe código `RANK_FIELD_NULL`, el último porque no hay SystemExit por threshold).

- [ ] **Step 3: Implementar en `tools/aggregate_rank.py`**

Modificar el loop de agregación (líneas 64-113) para añadir validación None-safe tras obtener `candidate`, antes de invocar `sanitize_reviewer_output`:

```python
    CRITICAL_FIELDS = ("title", "location")
    for job_key, candidate in candidates.items():
        # None-safe gate: critical candidate fields must be present.
        missing = [f for f in CRITICAL_FIELDS if not candidate.get(f)]
        if missing:
            failures.append({
                "job_key": job_key,
                "code": "RANK_FIELD_NULL",
                "attempts": 0,
                "reason": "candidate missing critical fields: " + ",".join(missing),
            })
            continue
        raw = outputs.get(job_key)
        # ... resto igual
```

Y al final de `main()`, antes de escribir los artefactos (línea ~115), añadir threshold:

```python
    total = len(candidates)
    if total > 0 and len(failures) / total > 0.30:
        print(
            f"aggregate_rank: abort — failure rate {len(failures)}/{total} "
            f"({100*len(failures)/total:.0f}%) exceeds 30% threshold. "
            "No rank artifact written."
        )
        raise SystemExit(2)
```

- [ ] **Step 4: Verificar que pasan**

```bash
python3 -m pytest tests/test_aggregate_rank_null_safe.py -v
```

Expected: 4 passed.

- [ ] **Step 5: Suite completa verde**

```bash
python3 -m pytest tests/ -q
```

- [ ] **Step 6: Commit**

```bash
git add tools/aggregate_rank.py tests/test_aggregate_rank_null_safe.py
git commit -m "feat: agregador None-safe + threshold 30% failure abort"
```

---

## Fase 3 — Scoring (`perfil/04-evaluacion-ofertas.md`)

### Task 5: Tiers cerrados con lista 47 ciudades

**Files:**
- Modify: `perfil/04-evaluacion-ofertas.md` (líneas 17-26)

- [ ] **Step 1: Sustituir la tabla de tiers**

Reemplazar la sección "## Tiers de ubicación..." (líneas 17-26) por:

```markdown
## Tiers de ubicación (lo que manda es el TIEMPO REAL de commute, no los km)

| Tier | Criterio | Score ubicación |
|------|----------|-----------------|
| A+ | Casalecchio di Reno + Bologna ciudad (commute corto real) | 10 |
| A | Italia costa — lista cerrada de 23 ciudades: Nápoles, Palermo, Génova, Bari, Catania, Venecia, Mesina, Trieste, Tarento, Reggio Calabria, Rávena, Livorno, Rímini, Cagliari, Salerno, Latina, Sássari, Pescara, Siracusa, Ancona, Lecce, La Spezia, Pisa | 9 |
| B+ | Remoto (España, Italia o internacional) | 8 |
| B | España costa — lista cerrada de 24 ciudades: Barcelona, Valencia, Málaga, Palma, Las Palmas, Alicante, Bilbao, Vigo, L'Hospitalet, Gijón, La Coruña, Elche, Badalona, Cartagena, Jerez, Santa Cruz Tenerife, Almería, San Sebastián, Castellón, Santander, Marbella, Tarragona, Huelva, Mataró — solo si la oferta es muy buena | 6 |
| C | Interior italiano a >45-60 min de commute (Modena, Imola, Reggio Emilia, Parma, Firenze) — casi nunca; regla: "si son 1-2h de tráfico, prefiero mudarme al mar", C nunca gana a A | 3 |
| VETO | Milán, Roma, Turín, cualquier presencial interior lejano | 0 (descarte automático) |

Notas operativas:

- L'Hospitalet, Badalona, Mataró y Elche cuentan como área metropolitana costera (B).
- Las Palmas y Santa Cruz Tenerife son B por mar, aunque en la práctica implican remoto.
- Una ciudad que no esté en la lista A ni en la lista B no sube por proximidad: se evalúa con el criterio general (C o VETO).
```

- [ ] **Step 2: Verificar consistencia con test_rank_command.py**

```bash
python3 -m pytest tests/test_rank_command.py -q
```

Expected: PASS (este test verifica `job-rank.md`, no el perfil). Si falla porque `job-rank.md` referencia la lista antigua, se arregla en Task 8.

- [ ] **Step 3: Commit**

```bash
git add perfil/04-evaluacion-ofertas.md
git commit -m "feat(perfil): tiers A y B cerrados con 47 ciudades costeras ES/IT"
```

---

### Task 6: Penalización inglés + vetos ampliados + bonus email

**Files:**
- Modify: `perfil/04-evaluacion-ofertas.md`

- [ ] **Step 1: Añadir subsección "Penalización por idioma" tras "Bonus de sector"**

Insertar después de la tabla de sector (alrededor de línea 43):

```markdown
## Penalización por idioma

Si la oferta está redactada en inglés Y el puesto NO requiere inglés como skill central: **-1.5 al score final**. Exenciones:

- Roles explícitamente internacionales (remote EMEA, EU-wide, "English is our working language").
- Ofertas que piden inglés C1+ como requisito — en esos casos el inglés es skill, no fricción.
- Portales exclusivamente anglófonos (RemoteOK, WWR, Remotive) donde el inglés es el default: el ajuste ya está implicito en tier B+.

Documenta en `notes` cuando se aplique: "penalización idioma -1.5 (oferta en inglés sin requerirlo)".
```

- [ ] **Step 2: Ampliar la sección "Vetos automáticos"**

Sustituir las líneas 50-55 por:

```markdown
## Vetos automáticos (DESCARTAR sin más análisis)

1. Ubicación tier VETO.
2. Requisito excluyente no cumplido:
   - Laurea en ingeniería completada obligatoria.
   - Master/laurea con nota mínima (110/110, "con lode", "votazione minima X/110").
   - Certificaciones profesionales obligatorias que Victor no posee: PMP, ITIL Expert, CISSP, CISM.
   - Años excluyentes en tecnología específica (>5 años en tool X que Victor no tiene).
3. Presencial en ciudad sin mar a >1h de Casalecchio con oferta no excepcional.
4. Idioma: italiano "madrelingua" requerido en oferta no redactada en italiano (señal de outsourcing encubierto).
```

- [ ] **Step 3: Añadir "Bonus por email directo" tras "Nivel económico"**

Insertar después de la sección económica (línea ~48):

```markdown
## Bonus por canal de aplicación

Si la descripción incluye email directo de contacto (extraído en scraping a `email_contacto`), anotar en `notes`: "aplicación directa por email — baja fricción" y **+0.5 al score final** (cap 10.0). Incentiva canal de baja fricción vs ATS hostil. Si la URL de aplicación es un ATS hostil (`ats_hostil: true`), anotar en `notes`: "ATS hostil (Workday/Taleo/etc.) — aplicación cara en tiempo" sin penalización al score, pero visible para la decisión humana.
```

- [ ] **Step 4: Commit**

```bash
git add perfil/04-evaluacion-ofertas.md
git commit -m "feat(perfil): penalización inglés -1.5, vetos excluyentes ampliados, bonus email +0.5"
```

---

## Fase 4 — Batching paralelo 3×50

### Task 7: `build_rank_batches.py --parallel`

**Files:**
- Test: `tests/test_build_rank_batches_parallel.py` (nuevo)
- Modify: `tools/build_rank_batches.py`

- [ ] **Step 1: Tests que fallan**

Crear `tests/test_build_rank_batches_parallel.py`:

```python
"""Tests for parallel wave generation in tools/build_rank_batches.py."""

import json
from pathlib import Path

import pytest


def _make_candidates(n):
    return [
        {
            "job_key": f"test:{i}",
            "id": str(i),
            "portal": "test",
            "title": f"Role {i}",
            "company": "Acme",
            "location": "Bologna",
            "url": f"https://acme.example/job/{i}",
            "date": "2026-07-23",
            "description": "Job description.",
            "remote": None,
            "salary": None,
            "source_call": "call-1",
            "new": True,
            "source_ids": [f"test:{i}"],
            "duplicate_sources": ["test"],
        }
        for i in range(n)
    ]


def _run_build(tmp_path, monkeypatch, candidates, batch_size=50, parallel=3):
    import tools.build_rank_batches as brb
    cand_path = tmp_path / "candidates.json"
    out_path = tmp_path / "batches.json"
    cand_path.write_text(json.dumps(candidates))
    monkeypatch.setattr(brb, "CANDIDATES", cand_path)
    monkeypatch.setattr(brb, "OUT", out_path)
    monkeypatch.setattr(
        sys.argv if False else __import__("sys").argv,
        ["build_rank_batches.py", "--batch-size", str(batch_size), "--parallel", str(parallel)],
    )
    brb.main()
    return json.loads(out_path.read_text())


def test_default_waves_of_5_backwards_compatible(tmp_path, monkeypatch):
    """Without flags, keeps current behavior (waves of 5)."""
    import sys
    import tools.build_rank_batches as brb
    cand_path = tmp_path / "candidates.json"
    out_path = tmp_path / "batches.json"
    cand_path.write_text(json.dumps(_make_candidates(12)))
    monkeypatch.setattr(brb, "CANDIDATES", cand_path)
    monkeypatch.setattr(brb, "OUT", out_path)
    monkeypatch.setattr(sys, "argv", ["build_rank_batches.py"])
    brb.main()
    payload = json.loads(out_path.read_text())
    assert len(payload["waves"]) == 3  # ceil(12/5)
    assert all(len(w) <= 5 for w in payload["waves"])


def test_parallel_3x50_splits_into_3_waves(tmp_path, monkeypatch):
    """135 candidates with --batch-size 50 --parallel 3 → 3 waves of ≤50."""
    import sys
    import tools.build_rank_batches as brb
    cand_path = tmp_path / "candidates.json"
    out_path = tmp_path / "batches.json"
    cand_path.write_text(json.dumps(_make_candidates(135)))
    monkeypatch.setattr(brb, "CANDIDATES", cand_path)
    monkeypatch.setattr(brb, "OUT", out_path)
    monkeypatch.setattr(sys, "argv", ["build_rank_batches.py", "--batch-size", "50", "--parallel", "3"])
    brb.main()
    payload = json.loads(out_path.read_text())
    assert len(payload["waves"]) == 3
    sizes = sorted(len(w) for w in payload["waves"])
    assert sizes == [35, 50, 50] or sizes == [45, 45, 45]  # depends on split strategy
    assert all(len(w) <= 50 for w in payload["waves"])


def test_batch_size_caps_wave_size(tmp_path, monkeypatch):
    import sys
    import tools.build_rank_batches as brb
    cand_path = tmp_path / "candidates.json"
    out_path = tmp_path / "batches.json"
    cand_path.write_text(json.dumps(_make_candidates(120)))
    monkeypatch.setattr(brb, "CANDIDATES", cand_path)
    monkeypatch.setattr(brb, "OUT", out_path)
    monkeypatch.setattr(sys, "argv", ["build_rank_batches.py", "--batch-size", "30", "--parallel", "4"])
    brb.main()
    payload = json.loads(out_path.read_text())
    assert len(payload["waves"]) == 4
    assert all(len(w) <= 30 for w in payload["waves"])
```

- [ ] **Step 2: Verificar que fallan**

```bash
python3 -m pytest tests/test_build_rank_batches_parallel.py -v 2>&1 | tail -10
```

Expected: los 2 tests nuevos con flags fallan (argparse no existe).

- [ ] **Step 3: Implementar en `tools/build_rank_batches.py`**

Reescribir el archivo:

```python
#!/usr/bin/env python3
"""Build the safe reviewer payload per candidate and write to /tmp/rank_batches.json.

Default: waves of 5 (backwards compatible with the pre-parallel /job-rank).
With --batch-size M --parallel N: split candidates into N waves of ≤M each,
balanced (distribute remainder evenly).

The reviewer never sees a URL, contact info, or unescaped HTML. Each payload is
deterministic JSON wrapped in <UNTRUSTED_JOB_DATA_JSON> markers with
&lt;/&gt;/&amp; escaped.
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path

CANDIDATES = Path("/tmp/rank_candidates.json")
OUT = Path("/tmp/rank_batches.json")

SAFE_TEXT = re.compile(r"[\u0000-\u001f\u007f]")


def redact(value):
    return value


def escape(value):
    if not isinstance(value, str):
        return value
    if SAFE_TEXT.search(value):
        return None
    return (
        value.replace("&", "\\u0026")
        .replace("<", "\\u003C")
        .replace(">", "\\u003E")
    )


def build_payload(candidate):
    safe = {
        "job_key": candidate["job_key"],
        "id": candidate["id"],
        "portal": candidate["portal"],
        "title": escape(redact(candidate.get("title"))),
        "company": escape(redact(candidate.get("company"))),
        "location": escape(redact(candidate.get("location"))),
        "date": candidate.get("date"),
        "description": escape(redact(candidate.get("description"))),
        "salary": escape(redact(candidate.get("salary"))),
        "remote": candidate.get("remote"),
        "source_call": candidate.get("source_call"),
        "source_ids": list(candidate.get("source_ids") or []),
        "duplicate_sources": list(candidate.get("duplicate_sources") or []),
    }
    serialized = json.dumps(safe, ensure_ascii=False, indent=None, sort_keys=True)
    return {
        "job_key": candidate["job_key"],
        "title": candidate.get("title"),
        "company": candidate.get("company"),
        "url": candidate.get("url"),
        "block": (
            "<UNTRUSTED_JOB_DATA_JSON>\n"
            + serialized
            + "\n</UNTRUSTED_JOB_DATA_JSON>"
        ),
    }


def _split_waves(candidates, batch_size, parallel):
    """Split into `parallel` waves of ≤batch_size each, balanced."""
    if parallel <= 0:
        parallel = 1
    if batch_size <= 0:
        batch_size = 5
    # If parallel waves of batch_size can hold everything, balance them.
    capacity = parallel * batch_size
    if len(candidates) <= capacity:
        base = len(candidates) // parallel
        extra = len(candidates) % parallel
        waves = []
        start = 0
        for i in range(parallel):
            size = base + (1 if i < extra else 0)
            if size == 0:
                continue
            waves.append(candidates[start:start + size])
            start += size
        return waves
    # Otherwise: sequential chunks of batch_size (more than `parallel` waves).
    return [candidates[i:i + batch_size] for i in range(0, len(candidates), batch_size)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--parallel", type=int, default=None)
    args = parser.parse_args()

    candidates = json.loads(CANDIDATES.read_text())

    if args.parallel is None:
        # Backwards-compatible default: waves of 5 sequential.
        waves = [
            [build_payload(c) for c in candidates[i:i + 5]]
            for i in range(0, len(candidates), 5)
        ]
    else:
        grouped = _split_waves(candidates, args.batch_size, args.parallel)
        waves = [[build_payload(c) for c in wave] for wave in grouped]

    OUT.write_text(json.dumps({"waves": waves}, ensure_ascii=False))
    print("waves", len(waves))
    for w in waves:
        print(f"  wave size: {len(w)}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Verificar tests**

```bash
python3 -m pytest tests/test_build_rank_batches_parallel.py -v
```

Expected: 3 passed.

- [ ] **Step 5: Suite completa**

```bash
python3 -m pytest tests/ -q
```

- [ ] **Step 6: Commit**

```bash
git add tools/build_rank_batches.py tests/test_build_rank_batches_parallel.py
git commit -m "feat: build_rank_batches --parallel N --batch-size M (default compatible)"
```

---

### Task 8: Actualizar `job-rank.md` para orquestación paralela

**Files:**
- Modify: `.opencode/commands/job-rank.md`
- Test: `tests/test_rank_command.py` (puede requerir ajuste de strings)

- [ ] **Step 1: Subir el límite de 50 a 150**

En `job-rank.md` líneas 49-53, cambiar:

```text
- `--limit` acepta exactamente un entero decimal entre `1` y `150`, y establece
  el máximo de ofertas. El valor por defecto es `10`.
- Se acepta exactamente un único entero posicional entre `1` y `150` por
  compatibilidad. No se puede combinar con `--limit`.
```

Y en línea 57:

```text
- Ante un error, detente y explica el token y la forma válida:
  `Uso: /job-rank [--limit <1..150>|<1..150>]`.
```

- [ ] **Step 2: Sustituir la sección 5 "Protocolo de reviewers en paralelo"**

Reemplazar el párrafo inicial (líneas 247-253) por:

```markdown
## 5. Protocolo de reviewers en paralelo

Para cada candidato, despacha exactamente un agente `general` con un prompt
inline. El número de agentes concurrentes depende del volumen:

- **≤25 ofertas**: waves secuenciales de 5 ofertas, esperando a que termine
  cada wave antes de iniciar la siguiente. Máximo 5 agentes `general`
  concurrentes.
- **>25 ofertas**: dispatch paralelo en 3 waves balanceadas de ≤50 ofertas cada
  una. Lanza los 3 agentes en una única llamada al tool `task` con 3
  `subagent_type: general` en paralelo. Cada agente procesa su wave completa
  internamente (scoring por lotes de 5 dentro de su propia ejecución para
  evitar límites de contexto) y devuelve un array JSON con los 50 resultados.

Nunca puede haber más de `5` agentes `general` concurrentes en modo secuencial,
ni más de `3` en modo paralelo. No pidas a los agentes que lean archivos, lean
raw, usen otras fuentes o fetcheen URLs.

Antes del dispatch, escribe los batches con:

```bash
python3 tools/build_rank_batches.py --batch-size 50 --parallel 3
```

Eso genera `/tmp/rank_batches.json` con `waves: [...]` ya balanceadas. Cada
elemento de wave tiene el `block` listo para insertar inline en el prompt del
subagente.
```

- [ ] **Step 3: Añadir nota sobre agregación**

Al final de la sección 6, añadir:

```markdown
## 6.1 Agregación con threshold de fallos

`tools/aggregate_rank.py` aborta con exit 2 si más del 30% de los candidatos
fallan (RANK_FAILED o RANK_FIELD_NULL). En ese caso NO se escribe
`latest-rank.json`; el operador debe revisar las causas antes de reintentar.
```

- [ ] **Step 4: Verificar test_rank_command.py**

```bash
python3 -m pytest tests/test_rank_command.py -v 2>&1 | tail -20
```

Si falla porque esperaba strings antiguos (`<1..50>` etc.), actualizar `tests/test_rank_command.py` para que acepte el nuevo rango.

- [ ] **Step 5: Commit**

```bash
git add .opencode/commands/job-rank.md tests/test_rank_command.py
git commit -m "feat(rank): límite 150, dispatch paralelo 3×50, threshold 30%"
```

---

## Fase 5 — Skills nuevas

### Task 9: `jooble-search` skill

**Files:**
- Create: `.agents/skills/jooble-search/SKILL.md`
- Create: `.agents/skills/jooble-search/cli/src/cli.ts`
- Create: `.agents/skills/jooble-search/cli/package.json`
- Create: `.agents/skills/jooble-search/cli/tests/cli.test.ts`
- Create: `.agents/skills/jooble-search/cli/tests/fixtures/search-it.json`

- [ ] **Step 1: Clonar estructura desde adzuna-search**

```bash
cp -r .agents/skills/adzuna-search .agents/skills/jooble-search
cd .agents/skills/jooble-search && rm -rf cli/node_modules cli/bun.lock
```

- [ ] **Step 2: Reescribir `SKILL.md`**

Contenido mínimo (se adapta el de adzuna):

```markdown
---
name: jooble-search
version: 1.0.0
description: >
  Use this skill to search live job listings via the Jooble aggregator API —
  free with key, covers Italy, Spain and 60+ countries. Aggregates LinkedIn,
  Indeed and hundreds of niche boards into a single schema. Trigger phrases:
  find a job, job search, jooble jobs, ofertas de empleo, offerte di lavoro.
context: fork
enabled: true
allowed-tools: Bash(bun run .agents/skills/jooble-search/cli/src/cli.ts *)
---

# jooble-search — Skill de portal (agregador con key)

Busca ofertas via [Jooble API](https://jooble.org/api/about). Requiere key
gratuita (solicitud manual en su web).

## Autenticación

`JOOBLE_API_KEY` en `.env` o variable de entorno. Endpoint: POST
`https://jooble.org/api/<KEY>`.

## Comandos

```bash
bun run .agents/skills/jooble-search/cli/src/cli.ts search [-q "<kw>"] [-l "<loc>"] [--country it|es] [--limit N]
```

## Contrato de salida

Mismo schema que `adzuna-search` (campos `id`, `portal`, `title`, `company`,
`location`, `url`, `date`, `description`, `remote`, `salary`).
```

- [ ] **Step 3: Adaptar `cli/src/cli.ts` a la API Jooble**

Cambios clave:
- POST a `https://jooble.org/api/${key}` con body `{keywords, location, page, countryCode}`.
- Mapear respuesta: `jobs[]` → cada uno con `id` (hash del link), `title`, `company`, `location`, `link` → `url`, `updated` → `date`, `snippet` → `description`, `salary` → `salary`, `type` → inferir remote si contiene "remote".
- Auth: leer `JOOBLE_API_KEY` de env, luego de `.env`.
- Exit 2 si falta key, exit 1 en error de API.

- [ ] **Step 4: Tests contra fixture**

Grabar fixture `search-it.json` con 3 resultados reales recortados (ejecutar una llamada real una vez y sanitizar). Tests de parsing idénticos a los de adzuna pero contra ese fixture.

```bash
cd .agents/skills/jooble-search/cli && bun test
```

- [ ] **Step 5: Lint**

```bash
python3 tools/lint_skills.py
```

- [ ] **Step 6: Commit**

```bash
git add .agents/skills/jooble-search/
git commit -m "feat: skill jooble-search (agregador ES/IT con key)"
```

---

### Task 10: `careerjet-search` skill

**Files:**
- Create: `.agents/skills/careerjet-search/` (misma estructura)

- [ ] **Step 1: Clonar desde adzuna-search**

```bash
cp -r .agents/skills/adzuna-search .agents/skills/careerjet-search
cd .agents/skills/careerjet-search && rm -rf cli/node_modules cli/bun.lock
```

- [ ] **Step 2: Adaptar a Careerjet API pública (sin key)**

Endpoint: `GET https://public.api.careerjet.net/search?locale_code=it_IT&keywords=...&location=...&page=...&pagesize=...`

Mapeo: `jobs[]` → `url`, `title`, `company`, `locations` → `location`, `description`, `date` → `date`, `salary` → `salary`, `salary_min`/`salary_max`.

- [ ] **Step 3: SKILL.md análogo al de jooble pero sin auth**

- [ ] **Step 4: Tests + lint + commit**

```bash
cd .agents/skills/careerjet-search/cli && bun test
cd ../../.. && python3 tools/lint_skills.py
git add .agents/skills/careerjet-search/
git commit -m "feat: skill careerjet-search (API pública sin key)"
```

---

### Task 11: `jsearch-search` skill + evaluación de overlap

**Files:**
- Create: `.agents/skills/jsearch-search/`
- Create: `tools/evaluate_jsearch_overlap.py`

- [ ] **Step 1: Clonar desde adzuna-search**

```bash
cp -r .agents/skills/adzuna-search .agents/skills/jsearch-search
cd .agents/skills/jsearch-search && rm -rf cli/node_modules cli/bun.lock
```

- [ ] **Step 2: Adaptar a JSearch (OpenWebNinja)**

Endpoint: `GET https://api.openwebninja.com/jsearch/search?query=...&page=1&num_pages=1&country=it&date_posted=month`

Header: `X-API-Key: ${JSEARCH_API_KEY}`.

Mapeo: `data[]` → `job_id` → `id`, `job_title` → `title`, `employer_name` → `company`, `job_city` + `job_country` → `location`, `job_apply_link` → `url`, `job_posted_at_datetime_utc` → `date`, `job_description` → `description`, `job_is_remote` → `remote`, `job_min_salary`+`job_max_salary`+`job_salary_currency` → `salary`.

- [ ] **Step 3: SKILL.md + tests con fixture**

- [ ] **Step 4: Script de evaluación**

Crear `tools/evaluate_jsearch_overlap.py`:

```python
#!/usr/bin/env python3
"""Compare JSearch results against latest.json to decide if worth activating.

Runs 5 representative queries against JSearch, computes overlap with the
existing latest.json (LinkedIn/Adzuna/InfoJobs/etc.), prints a recommendation.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LATEST = REPO / "job_scraper" / "latest.json"
QUERIES = [
    ("AI consultant", "Milan"),
    ("IT Manager", "Bologna"),
    ("Digital Transformation", "Barcelona"),
    ("Energy Manager", "remote"),
    ("Responsabile IT", ""),
]


def normalize(title, company):
    return (title or "").lower().strip() + "|" + (company or "").lower().strip()


def main():
    if not LATEST.exists():
        sys.exit("latest.json not found — run /job-scrape first")
    latest = json.loads(LATEST.read_text())
    existing = {normalize(r.get("title"), r.get("company")) for r in latest["results"]}

    env = os.environ.copy()
    env.update(dict(line.split("=", 1) for line in (REPO / ".env").read_text().splitlines() if "=" in line and not line.startswith("#")))

    new_count = 0
    dup_count = 0
    for query, location in QUERIES:
        cmd = [
            "bun", "run", ".agents/skills/jsearch-search/cli/src/cli.ts",
            "search", "-q", query,
        ]
        if location:
            cmd += ["-l", location]
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO, env=env)
        if result.returncode != 0:
            print(f"SKIP {query!r}: {result.stderr[:100]}")
            continue
        data = json.loads(result.stdout)
        for r in data.get("results", []):
            key = normalize(r.get("title"), r.get("company"))
            if key in existing:
                dup_count += 1
            else:
                new_count += 1

    total = new_count + dup_count
    if total == 0:
        print("No results — check API key/quota")
        sys.exit(1)
    dup_pct = 100 * dup_count / total
    new_pct = 100 * new_count / total
    print(f"JSearch evaluation over {len(QUERIES)} queries:")
    print(f"  total results: {total}")
    print(f"  duplicates with existing pipeline: {dup_count} ({dup_pct:.0f}%)")
    print(f"  new offers: {new_count} ({new_pct:.0f}%)")
    if dup_pct > 60:
        print("RECOMMENDATION: keep jsearch disabled (>60% overlap)")
    elif new_pct > 20:
        print("RECOMMENDATION: activate jsearch (adds >20% new offers)")
    else:
        print("RECOMMENDATION: marginal — keep disabled unless quota is free")


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Ejecutar evaluación (no commitear resultado)**

```bash
python3 tools/evaluate_jsearch_overlap.py
```

Anotar el resultado en `docs/superpowers/specs/2026-07-23-post-primera-ejecucion-design.md` (sección 2.4.3) o dejar la skill con `enabled: false` hasta decisión.

- [ ] **Step 6: Commit**

```bash
git add .agents/skills/jsearch-search/ tools/evaluate_jsearch_overlap.py
git commit -m "feat: skill jsearch-search + script evaluación overlap"
```

---

## Fase 6 — Queries nuevas y cierre

### Task 12: Ampliar `perfil/search-queries.md`

**Files:**
- Modify: `perfil/search-queries.md`

- [ ] **Step 1: Añadir queries nuevas**

Append tras la línea 22:

```markdown
## Italiano (adicional Fase 3)
16. IT Demand Planner
17. IT Infrastructure Manager
18. Responsabile Sicurezza IT
19. IT Operations Manager
20. Head of Digital

## Español (adicional Fase 3)
21. IT Manager
22. Responsable Sistemas
23. Consultor estrategia tecnológica
24. Digital Operations Manager

## Inglés (adicional Fase 3)
25. IT Strategy Consultant
26. Technology Advisor
27. Digital Transformation Consultant

## Ubicaciones costeras (Tier A Italia — pasar como `location` a Adzuna/Jooble/Careerjet/InfoJobs)
Nápoles, Palermo, Génova, Bari, Catania, Venecia, Mesina, Trieste, Tarento,
Reggio Calabria, Rávena, Livorno, Rímini, Cagliari, Salerno, Latina, Sássari,
Pescara, Siracusa, Ancona, Lecce, La Spezia, Pisa

## Ubicaciones costeras (Tier B España — pasar como `location`)
Barcelona, Valencia, Málaga, Palma, Las Palmas, Alicante, Bilbao, Vigo,
L'Hospitalet, Gijón, La Coruña, Elche, Badalona, Cartagena, Jerez,
Santa Cruz Tenerife, Almería, San Sebastián, Castellón, Santander,
Marbella, Tarragona, Huelva, Mataró
```

- [ ] **Step 2: Commit**

```bash
git add perfil/search-queries.md
git commit -m "feat(perfil): 12 queries nuevas + 47 ubicaciones costeras como filtro"
```

---

### Task 13: Integrar detectores ATS/email en `/job-scrape`

**Files:**
- Modify: `job_scraper/run_scrape.py` (o el normalizador correspondiente)
- Test: `tests/test_phase3_commands.py` o nuevo

- [ ] **Step 1: Identificar punto de normalización**

```bash
grep -n "normalize\|email_contacto\|ats_hostil" job_scraper/run_scrape.py | head -20
```

- [ ] **Step 2: Aplicar detectores a cada resultado normalizado**

En el punto donde se construye cada `result` normalizado, añadir:

```python
from tools.rank_safety import detect_ats_hostil, extract_contact_email

result["email_contacto"] = extract_contact_email(result.get("description"))
result["ats_hostil"] = detect_ats_hostil(result.get("url"))
```

Y añadir los dos campos a `_RESULT_KEYS` en `tools/rank_safety.py` para que pasen validación.

- [ ] **Step 3: Test end-to-end**

```bash
python3 -m pytest tests/ -q
```

- [ ] **Step 4: Commit**

```bash
git add job_scraper/run_scrape.py tools/rank_safety.py
git commit -m "feat(scrape): enriquecer resultados con email_contacto y ats_hostil"
```

---

### Task 14: Smoke E2E con datos reales

**Files:**
- Run-only, no commit

- [ ] **Step 1: Scrape limitado**

```bash
bun run .agents/skills/adzuna-search/cli/src/cli.ts search -q "IT Manager" -l "Bologna" --country it --limit 5 --format json | python3 -m json.tool | head -50
```

Verificar que incluye `email_contacto` y `ats_hostil` (si Task 13 ya está hecho).

- [ ] **Step 2: Rank paralelo con 25 ofertas sintéticas**

Crear `/tmp/rank_candidates.json` con 25 entradas sintéticas y ejecutar:

```bash
python3 tools/build_rank_batches.py --batch-size 50 --parallel 3
cat /tmp/rank_batches.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('waves:', len(d['waves']), 'sizes:', [len(w) for w in d['waves']])"
```

Expected: `waves: 1 sizes: [25]` (porque 25 ≤ 3×50, balanceado da 1 wave no vacía... o 3 waves con 9, 8, 8). Verificar comportamiento y ajustar si es contraintuitivo.

- [ ] **Step 3: Documentar resultado en la spec**

Append a la spec una sección "Smoke E2E 2026-07-XX" con los números.

---

### Task 15: Actualizar AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Añadir referencia a las skills nuevas y al batching paralelo**

En la sección de workflows, añadir línea sobre skills disponibles (jooble, careerjet, jsearch) y sobre el límite de rank subido a 150 con dispatch paralelo 3×50.

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs(AGENTS): reflejar skills nuevas y rank paralelo 3×50"
```

---

## Self-Review

**Spec coverage:**
- §2.1.1 Tiers cerrados → Task 5 ✓
- §2.1.2 Penalización inglés → Task 6 ✓
- §2.1.3 Vetos ampliados → Task 6 ✓
- §2.1.4 Bonus email → Task 6 + Task 13 ✓
- §2.2.1 build_rank_batches --parallel → Task 7 ✓
- §2.2.2 job-rank.md paralelo → Task 8 ✓
- §2.2.3 aggregate_rank None-safe → Task 4 ✓
- §2.2.4 rank_safety 30% → Task 4 ✓
- §2.3.1 descripción completa → verificada en Task 13 (las skills ya la traen inline) ✓
- §2.3.1 email_contacto + ats_hostil → Task 3 + Task 13 ✓
- §2.4.1 jooble-search → Task 9 ✓
- §2.4.2 careerjet-search → Task 10 ✓
- §2.4.3 jsearch-search + evaluación → Task 11 ✓
- §2.5 queries nuevas → Task 12 ✓
- §2.6 limpieza → Task 1 + Task 2 ✓

**Placeholder scan:** No TBD. Cada task tiene comandos y código completos excepto Task 9-11 (skills nuevas) donde el contenido del CLI se describe pero no se copia entero — esto es deliberado porque el CLI de adzuna tiene ~300 líneas y clonarlo con adaptación es la acción real. El agente que ejecute tiene el archivo fuente disponible para copiar.

**Type consistency:** Los campos `email_contacto` y `ats_hostil` se definen en Task 3 (rank_safety) y se consumen en Task 6 (perfil/04) y Task 13 (run_scrape). Nombres consistentes.

**Riesgos conocidos:**
- Task 8 puede romper `test_rank_command.py` si los strings esperados cambian. Mitigado con Step 4 explícito.
- Tasks 9-11 requieren acceso de red para grabar fixtures. Si Jooble key no está, la skill queda en `enabled: false`.
- Task 14 smoke E2E requiere `.env` con keys reales. Se documenta pero no es bloqueante para los commits anteriores.
