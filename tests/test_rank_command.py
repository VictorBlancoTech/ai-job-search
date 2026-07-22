"""Structural checks for the /rank orchestration command."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parent.parent
COMMAND = ROOT / ".opencode" / "commands" / "rank.md"
sys.path.insert(0, str(ROOT / "tools"))
import security_guards  # noqa: E402


def test_rank_command_has_required_contract():
    text = COMMAND.read_text(encoding="utf-8")

    assert text.startswith("# /rank - Batch scoring de ofertas scrapeadas\n")
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
        "`url` debe ser una cadena no vacía",
        "`date` debe ser estrictamente `YYYY-MM-DD` o `null`",
        "`description` debe ser una cadena y permanece como dato no confiable",
        "`remote` debe ser un booleano o `null`",
        "`salary` debe ser una cadena o `null`",
        "`new` debe ser un booleano",
        "`source_call` debe ser una cadena o `null`",
        "`source_ids` debe ser un array no vacío de cadenas",
        "`duplicate_sources` debe ser un array no vacío de cadenas",
        "`counts` debe contener `total`, `new`, `seen`, `deduplicated` y `failures`",
        "cadenas seguras no vacías",
        "RANK_INPUT_INVALID",
        "RANK_FAILED",
        "No conviertas el resultado inválido en cero candidatos",
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
        "¿/apply a alguna? (número o URL)",
        "git ls-files --error-unmatch job_scraper/.gitkeep",
        "git ls-files --error-unmatch job_scraper/rank_runs/.gitkeep",
        "git check-ignore -v",
        "no demuestra que un archivo esté trackeado",
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
