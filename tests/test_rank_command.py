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
    for required in (
        "job_scraper/latest.json",
        "new: true",
        "--limit",
        "RANK_FAILED",
        "source_run_id",
        "job_scraper/rank_runs/<run_id>.json",
        "job_scraper/latest-rank.json",
        "¿/apply a alguna? (número o URL)",
    ):
        assert required in text


def test_rank_artifacts_are_required_ignored_rules():
    rules = {
        line.strip()
        for line in (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
    }

    assert "job_scraper/rank_runs/" in rules
    assert "job_scraper/latest-rank.json" in rules
    assert "job_scraper/rank_runs/" in security_guards.REQUIRED_IGNORE_RULES
    assert "job_scraper/latest-rank.json" in security_guards.REQUIRED_IGNORE_RULES
