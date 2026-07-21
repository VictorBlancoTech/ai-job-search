#!/usr/bin/env python3
"""Tests for tools/security_guards.py — run: pytest tests/test_security_guards.py -v"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
GUARD_SCRIPT = ROOT / "tools" / "security_guards.py"

sys.path.insert(0, str(ROOT / "tools"))
import security_guards  # noqa: E402  (imported for its allowlist constants)


def run_guards(root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(root / "tools" / "security_guards.py")],
        capture_output=True, text=True, cwd=root,
    )


@pytest.fixture
def fixture_repo(tmp_path: Path) -> Path:
    """Minimal repo tree the guard passes on; each test mutates one thing."""
    tools = tmp_path / "tools"
    tools.mkdir()
    shutil.copy(GUARD_SCRIPT, tools / "security_guards.py")

    (tmp_path / ".gitignore").write_text(
        "\n".join(security_guards.REQUIRED_IGNORE_RULES)
        + "\n"
        + "\n".join(sorted(security_guards.ALLOWED_IGNORE_NEGATIONS))
        + "\n"
    )

    manifest = tmp_path / ".agents" / "skills" / "example-search" / "cli" / "package.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(json.dumps({"name": "example-cli", "scripts": {"start": "bun run src/cli.ts"}}))

    return tmp_path


# --- Failure-path (mutation) tests on a fixture repo ---

def test_missing_required_ignore_rule_fails(fixture_repo):
    for rule in security_guards.REQUIRED_IGNORE_RULES:
        remaining = [r for r in security_guards.REQUIRED_IGNORE_RULES if r != rule]
        (fixture_repo / ".gitignore").write_text("\n".join(remaining) + "\n")
        result = run_guards(fixture_repo)
        assert result.returncode == 1, f"rule {rule!r}: expected failure, got OK"
        assert "required personal-data rule missing" in result.stdout
        assert rule in result.stdout


def test_unallowlisted_negation_fails(fixture_repo):
    with (fixture_repo / ".gitignore").open("a") as f:
        f.write("!.env\n")
    result = run_guards(fixture_repo)
    assert result.returncode == 1
    assert "negation rule not in the reviewed allowlist" in result.stdout
    assert "!.env" in result.stdout


def test_postinstall_script_fails(fixture_repo):
    manifest = fixture_repo / ".agents" / "skills" / "example-search" / "cli" / "package.json"
    manifest.write_text(json.dumps({"name": "example-cli", "scripts": {"postinstall": "echo test"}}))
    result = run_guards(fixture_repo)
    assert result.returncode == 1
    assert "lifecycle script" in result.stdout
    assert "postinstall" in result.stdout


def test_trusted_dependencies_fails(fixture_repo):
    manifest = fixture_repo / ".agents" / "skills" / "example-search" / "cli" / "package.json"
    manifest.write_text(json.dumps({"name": "example-cli", "trustedDependencies": ["left-pad"]}))
    result = run_guards(fixture_repo)
    assert result.returncode == 1
    assert "trustedDependencies" in result.stdout


def test_clean_fixture_repo_passes(fixture_repo):
    result = run_guards(fixture_repo)
    assert result.returncode == 0, result.stdout


# --- Live-repo tests (what CI runs) ---

def test_guards_pass_on_repo():
    result = run_guards(ROOT)
    assert result.returncode == 0, result.stdout


def test_env_is_ignored():
    rules = (ROOT / ".gitignore").read_text().splitlines()
    assert ".env" in [r.strip() for r in rules]


def test_tracker_is_ignored():
    rules = (ROOT / ".gitignore").read_text().splitlines()
    assert "tracker/job_search_tracker.csv" in [r.strip() for r in rules]
    assert "tracker/aplicaciones/**" in [r.strip() for r in rules]


def test_postings_are_ignored():
    rules = (ROOT / ".gitignore").read_text().splitlines()
    assert "documents/postings/**" in [r.strip() for r in rules]
    assert "documents/postings/**" in security_guards.REQUIRED_IGNORE_RULES
