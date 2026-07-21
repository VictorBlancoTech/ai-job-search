#!/usr/bin/env python3
"""Tests for tools/security_guards.py — run: pytest tests/test_security_guards.py -v"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def run_guards() -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(ROOT / "tools" / "security_guards.py")],
        capture_output=True, text=True, cwd=ROOT,
    )


def test_guards_pass_on_repo():
    result = run_guards()
    assert result.returncode == 0, result.stdout


def test_env_is_ignored():
    rules = (ROOT / ".gitignore").read_text().splitlines()
    assert ".env" in [r.strip() for r in rules]


def test_tracker_is_ignored():
    rules = (ROOT / ".gitignore").read_text().splitlines()
    assert "tracker/job_search_tracker.csv" in [r.strip() for r in rules]
    assert "tracker/aplicaciones/**" in [r.strip() for r in rules]
