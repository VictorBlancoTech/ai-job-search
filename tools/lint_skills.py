#!/usr/bin/env python3
"""Lint the repo's skill and command files.

Run from anywhere: python tools/lint_skills.py

Checks:
- Every SKILL.md (.agents/skills/*/SKILL.md) has YAML frontmatter that
  parses, with non-empty `name` and `description` keys
- `allowed-tools` entries of the form `Bash(bun run <path> *)` point at files
  that exist (skill paths resolve relative to the repo root and to .agents/)
- Every .opencode/commands/job-*.md has YAML frontmatter with a non-empty
  `description` and its body starts with a matching `# /<name>` title

Exit code 0 on success, 1 with a failure list otherwise.
"""

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.exit("lint_skills.py requires PyYAML: pip install pyyaml")

ROOT = Path(__file__).resolve().parent.parent
errors: list[str] = []


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def check_skill(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        errors.append(f"{rel(path)}: missing YAML frontmatter (file must start with ---)")
        return
    end = text.find("\n---", 4)
    if end == -1:
        errors.append(f"{rel(path)}: unterminated YAML frontmatter")
        return
    try:
        data = yaml.safe_load(text[4:end])
    except yaml.YAMLError as exc:
        errors.append(f"{rel(path)}: frontmatter is not valid YAML: {exc}")
        return
    if not isinstance(data, dict):
        errors.append(f"{rel(path)}: frontmatter did not parse to a mapping")
        return
    for key in ("name", "description"):
        if not data.get(key):
            errors.append(f"{rel(path)}: frontmatter missing required key '{key}'")

    allowed = data.get("allowed-tools", "")
    if isinstance(allowed, str):
        for match in re.finditer(r"bun run ([^\s)]+)", allowed):
            target = match.group(1).rstrip("*")
            if not target or target.endswith("/"):
                continue
            # Targets may contain globs (e.g. .agents/skills/*/cli/src/cli.ts);
            # require at least one existing file to match.
            if "*" in target:
                if not list(ROOT.glob(target)) and not list((ROOT / ".agents").glob(target)):
                    errors.append(f"{rel(path)}: allowed-tools glob matches no files: {target}")
            else:
                candidates = [ROOT / target, ROOT / ".agents" / target]
                if not any(c.is_file() for c in candidates):
                    errors.append(f"{rel(path)}: allowed-tools references a missing file: {target}")


def check_commands(commands: list[Path]) -> None:
    for cmd in commands:
        text = cmd.read_text(encoding="utf-8")
        if not cmd.stem.startswith("job-"):
            errors.append(f"{rel(cmd)}: command filenames must use the 'job-' prefix")
        if not text.startswith("---\n"):
            errors.append(f"{rel(cmd)}: missing YAML frontmatter (commands require description)")
            continue
        end = text.find("\n---", 4)
        if end == -1:
            errors.append(f"{rel(cmd)}: unterminated YAML frontmatter")
            continue
        try:
            data = yaml.safe_load(text[4:end])
        except yaml.YAMLError as exc:
            errors.append(f"{rel(cmd)}: frontmatter is not valid YAML: {exc}")
            continue
        if not isinstance(data, dict):
            errors.append(f"{rel(cmd)}: frontmatter did not parse to a mapping")
            continue
        if not data.get("description"):
            errors.append(f"{rel(cmd)}: frontmatter missing required key 'description'")

        body = text[end + 4 :].lstrip("\n")
        lines = body.splitlines()
        first = lines[0] if lines else ""
        if not re.match(rf"^# /{re.escape(cmd.stem)}(\s|$)", first):
            errors.append(f"{rel(cmd)}: must start with a matching '# /{cmd.stem}' title")


def main() -> int:
    skills = sorted(ROOT.glob(".agents/skills/*/SKILL.md"))
    commands = sorted((ROOT / ".opencode" / "commands").glob("*.md"))
    if not skills:
        errors.append("no SKILL.md files found - glob roots are wrong or the tree moved")
    if not commands:
        errors.append("no command files found under .opencode/commands/")

    for skill in skills:
        check_skill(skill)
    check_commands(commands)

    if errors:
        print(f"lint_skills: {len(errors)} failure(s)")
        for err in errors:
            print(f"  - {err}")
        return 1
    print(f"lint_skills: OK ({len(skills)} skills, {len(commands)} commands)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
