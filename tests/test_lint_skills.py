#!/usr/bin/env python3
"""Tests for tools/lint_skills.py — run: pytest tests/test_lint_skills.py -v"""

import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
LINTER_SCRIPT = ROOT / "tools" / "lint_skills.py"


def run_linter(root: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        [sys.executable, str(root / "tools" / "lint_skills.py")],
        capture_output=True, text=True,
    )


@pytest.fixture
def fixture_repo(tmp_path: Path) -> Path:
    """Minimal repo tree the linter passes on; each test mutates one thing."""
    tools = tmp_path / "tools"
    tools.mkdir()
    shutil.copy(LINTER_SCRIPT, tools / "lint_skills.py")
    # The Python-test CI job does not install PyYAML; the separate lint job
    # does. These fixture tests only need a valid frontmatter map.
    (tools / "yaml.py").write_text(
        "class YAMLError(Exception):\n"
        "    pass\n\n"
        "def safe_load(text):\n"
        "    data = {'name': 'example'}\n"
        "    if 'description:' in text:\n"
        "        data['description'] = 'Example skill'\n"
        "    return data\n",
        encoding="utf-8",
    )

    command = tmp_path / ".opencode" / "commands" / "job-apply.md"
    command.parent.mkdir(parents=True)
    command.write_text(
        "---\ndescription: Test apply command\n---\n\n# /job-apply - Test apply command\n",
        encoding="utf-8",
    )

    skill = tmp_path / ".agents" / "skills" / "example" / "SKILL.md"
    skill.parent.mkdir(parents=True)
    skill.write_text(
        "---\nname: example\ndescription: Example skill\n---\n",
        encoding="utf-8",
    )

    return tmp_path


# --- Failure-path (mutation) tests on a fixture repo ---

def test_command_without_title_fails(fixture_repo):
    (fixture_repo / ".opencode" / "commands" / "job-apply.md").write_text(
        "---\ndescription: Test apply command\n---\n\nno title here\n",
        encoding="utf-8",
    )
    result = run_linter(fixture_repo)
    assert result.returncode == 1
    assert "must start with a matching '# /job-apply' title" in result.stdout
    assert "job-apply.md" in result.stdout


def test_command_with_bad_title_fails(fixture_repo):
    (fixture_repo / ".opencode" / "commands" / "job-apply.md").write_text(
        "---\ndescription: Test apply command\n---\n\n# Apply without slash\n",
        encoding="utf-8",
    )
    result = run_linter(fixture_repo)
    assert result.returncode == 1
    assert "must start with a matching '# /job-apply' title" in result.stdout


def test_command_without_description_fails(fixture_repo):
    (fixture_repo / ".opencode" / "commands" / "job-apply.md").write_text(
        "---\nname: apply\n---\n\n# /job-apply - Test apply command\n",
        encoding="utf-8",
    )
    result = run_linter(fixture_repo)
    assert result.returncode == 1
    assert "frontmatter missing required key 'description'" in result.stdout


def test_empty_command_file_fails_without_traceback(fixture_repo):
    (fixture_repo / ".opencode" / "commands" / "job-apply.md").write_text(
        "", encoding="utf-8"
    )
    result = run_linter(fixture_repo)
    assert result.returncode == 1
    assert "missing YAML frontmatter" in result.stdout
    assert "Traceback" not in result.stderr


def test_skill_without_frontmatter_fails(fixture_repo):
    (fixture_repo / ".agents" / "skills" / "example" / "SKILL.md").write_text(
        "# Example skill\n\nNo frontmatter here.\n", encoding="utf-8"
    )
    result = run_linter(fixture_repo)
    assert result.returncode == 1
    assert "missing YAML frontmatter" in result.stdout


def test_clean_fixture_repo_passes(fixture_repo):
    result = run_linter(fixture_repo)
    assert result.returncode == 0, result.stdout


# --- Live-repo tests (what CI runs) ---

def test_opencode_commands_have_frontmatter_and_prefixed_title():
    """Every command exposes a description and uses the job-* naming contract."""
    commands = sorted((ROOT / ".opencode" / "commands").glob("*.md"))
    assert commands, "no .opencode/commands found"
    for cmd in commands:
        assert cmd.stem.startswith("job-"), f"{cmd.name}: missing job- prefix"
        text = cmd.read_text(encoding="utf-8")
        assert text.startswith("---\n"), f"{cmd.name}: missing frontmatter"
        frontmatter, body = text[4:].split("\n---", 1)
        assert re.search(r"^description:\s*\S+", frontmatter, re.MULTILINE), (
            f"{cmd.name}: missing description"
        )
        first = body.lstrip("\n").splitlines()[0]
        assert re.match(rf"^# /{re.escape(cmd.stem)}(\s|$)", first), (
            f"{cmd.name}: title does not match filename"
        )


def test_lint_passes_on_repo():
    result = run_linter(ROOT)
    assert result.returncode == 0, result.stdout + result.stderr
