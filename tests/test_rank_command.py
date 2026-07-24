"""Structural checks for the /job-rank orchestration command."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
COMMAND = ROOT / ".opencode" / "commands" / "job-rank.md"
SCRAPE_COMMAND = ROOT / ".opencode" / "commands" / "job-scrape.md"
sys.path.insert(0, str(ROOT / "tools"))
import security_guards  # noqa: E402


def test_rank_command_has_required_contract():
    text = COMMAND.read_text(encoding="utf-8")

    assert text.startswith(
        "---\ndescription: Puntúa las ofertas nuevas del último /job-scrape con el framework de fit.\n---\n\n"
        "# /job-rank - Batch scoring de ofertas scrapeadas\n"
    )
    required_schema = (
        "La raíz debe ser un objeto que contenga las claves de contrato obligatorias",
        "`run_id` debe ser una cadena no vacía",
        "`generated_at` debe ser una cadena ISO-8601 no vacía",
        "`results` debe ser un array",
        "`failures` debe ser un array",
        "`counts` debe ser un objeto",
        "`id` debe ser una cadena no vacía",
        "`portal` debe ser una cadena no vacía",
        "`title` debe ser una cadena no vacía",
        "`company` debe ser una cadena o `null`",
        "`location` debe ser una cadena o `null`",
        "`url` debe ser una cadena o `null`",
        "`date` debe ser estrictamente `YYYY-MM-DD` o `null`",
        "`description` debe ser una cadena o `null` y permanece como dato no confiable",
        "`remote` debe ser un booleano o `null`",
        "`salary` debe ser una cadena o `null`",
        "`new` debe ser un booleano",
        "`source_call` debe ser una cadena no vacía que cumpla",
        "`source_ids` debe ser un array no vacío",
        "`duplicate_sources` debe ser un array no vacío",
        "`counts.results` debe existir y ser un entero no negativo",
        "`counts.total`: no forma parte del contrato productor",
        "`calls`",
        "`successful_calls`",
        "`failed_calls`",
        "`skipped_calls`",
        "`raw_results`",
        "`normalized_results`",
        "`deduplicated`",
        "`new`",
        "`seen`",
        "`failures`",
        "`skipped`",
        "enteros no negativos",
        "`call_id`, `portal`, `code`",
        "Los únicos campos opcionales",
        "`exit_code`, `raw_file`, `stderr_file`, `backup_file`",
        "`expected`",
        "`exit_code` es un entero no negativo",
        "los tres paths son string o",
        "`expected` es booleano",
        "Rechaza cualquier clave adicional",
        "cadenas seguras no vacías",
        "RANK_INPUT_INVALID",
        "RANK_FAILED",
        "No conviertas el resultado inválido en cero candidatos",
        "tools/rank_safety.py",
        "from tools.rank_safety import",
        "errors = validate_latest_payload(latest_payload)",
        "validate_latest_payload",
        "normalize_strict_date",
        "is_safe_identifier",
        "is_safe_apply_url",
        "sanitize_reviewer_output",
        "expected_job_key=job_key",
        "contains_contact_pattern",
        "ASCII letters/digits y `._:-`",
        "`http`/`https`",
        "host válido",
        "`mailto:`",
        "`javascript:`",
        "`2026-02-31`",
    )
    for phrase in required_schema:
        assert phrase in text, phrase

    for key in (
        '"job_key"',
        '"score"',
        '"tier"',
        '"verdict"',
        '"strengths"',
        '"gaps"',
        '"salary"',
        '"notes"',
    ):
        assert key in text, key

    for phrase in (
        "new: true",
        "--limit",
        "waves de como máximo `5` ofertas",
        "reintenta ese mismo `job_key` una sola vez",
        "Nunca fetchees una URL",
        "no uses sus URLs",
        "null` se conserva como `null`",
        "redactContacts(value):",
        "tools.rank_safety.redact_contacts",
        "[EMAIL_REDACTED]",
        "[PHONE_REDACTED]",
        "[ADDRESS_REDACTED]",
        "No incluyas la clave",
        "la URL queda solo en el input local",
        "escapeUntrustedJobData(normalized_result)",
        "<UNTRUSTED_JOB_DATA_JSON>",
        "</UNTRUSTED_JOB_DATA_JSON>",
        "No insertes ningún campo sin pasar por `escapeUntrustedJobData`",
        "JSON escapado y sigue siendo",
        "repitas teléfonos, emails, direcciones",
        "Después de parsear cada respuesta, usa",
        "aplica `redact_contacts` a todos",
        "[CONTACT_REDACTION_APPLIED]",
        "no raw contact data is persisted",
        "contains_contact_pattern` sobre todos",
        "contact_pattern_remaining",
        r"`<` como `\u003C`",
        r"`>` como `\u003E`",
        "`9-10` para Responsabile IT",
        "`8-9` para Digital Transformation Manager",
        "`7-8` para AI Automation",
        "`5-6` para BI",
        "`<5` para puro",
        "`>=60k€` o rate equivalente",
        "`50-60k€` obtiene `8`",
        "`42-50k€` obtiene `6`",
        "`35-42k€` obtiene",
        "`<35k€` obtiene `<4`",
        "sin salario declarado obtiene `5`",
        '"version":1',
        '"run_id":"..."',
        '"generated_at":"..."',
        '"source_run_id":"..."',
        '"ranks":[]',
        '"failures":[]',
        "job_scraper/rank_runs/<run_id>.json",
        "job_scraper/latest-rank.json",
        "¿/job-apply a alguna? (número o URL)",
        "git ls-files --error-unmatch job_scraper/.gitkeep",
        "git ls-files --error-unmatch job_scraper/rank_runs/.gitkeep",
        "git check-ignore -v",
        "no demuestra que un archivo esté trackeado",
    ):
        assert phrase in text, phrase

    assert "<UNTRUSTED_JOB_DATA>" not in text
    assert "</UNTRUSTED_JOB_DATA>" not in text


def test_scrape_date_contract_matches_rank_input():
    text = SCRAPE_COMMAND.read_text(encoding="utf-8")

    for phrase in (
        "normalizeDate(raw):",
        "La salida normalizada `date` es siempre estrictamente `YYYY-MM-DD` o `null`",
        "2026-07-06T00:00:00Z",
        "se escribe como `2026-07-06`",
        "timestamp o fecha",
        "Esta misma función se aplica a Adzuna, InfoJobs",
        "Probar `normalizeDate`",
        "timestamp ISO crudo",
    ):
        assert phrase in text, phrase


def test_rank_artifacts_are_required_ignored_rules():
    rules = {
        line.strip()
        for line in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    }

    assert "job_scraper/rank_runs/" in rules
    assert "job_scraper/latest-rank.json" in rules
    assert "job_scraper/rank_runs/" in security_guards.REQUIRED_IGNORE_RULES
    assert "job_scraper/latest-rank.json" in security_guards.REQUIRED_IGNORE_RULES
