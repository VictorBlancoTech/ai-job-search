#!/usr/bin/env python3
"""Supply-chain guards for the fork's riskiest surfaces.

Run from anywhere: python tools/security_guards.py

Checks:
1. .gitignore — personal-data ignore rules must all be present, and no
   un-allowlisted negation (!pattern) may re-include them.
2. .agents/**/package.json — no npm/bun lifecycle scripts (preinstall,
   install, postinstall, prepare, prepack) and no trustedDependencies.

Stdlib only. Exit 0 on success, 1 with a failure list otherwise.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
errors: list[str] = []

# Personal-data ignore rules that must never disappear from .gitignore.
REQUIRED_IGNORE_RULES = [
    ".env",
    # Depth-independent: the job-scraper skill resolves `job_scraper/` relative
    # to its own directory, so a repo-rooted rule would silently fail to match.
    "**/job_scraper/seen_jobs.json",
    "cv/victor_*.tex",
    # Real CV masters and their section subfolders (real personal data).
    "cv/victor-cv-master-*.tex",
    "cv/cv-master/**",
    "cv/cv-master-en/**",
    "cv/cv-es/**",
    # Required re-include so the template dir stays tracked (parent pattern
    # ignores cv/victor_*.tex only; this documents intent).
    "!cv/plantilla/",
    "perfil/01-perfil-candidato.md",
    "documents/cv/**",
    "documents/linkedin/**",
    "documents/diplomas/**",
    "documents/references/**",
    "documents/applications/**",
    "documents/interview/**",
    "documents/postings/**",
    "tracker/job_search_tracker.csv",
    "tracker/aplicaciones/**",
    "tracker/borradores/**",
]

# Negation (re-include) rules legitimately shipped.
ALLOWED_IGNORE_NEGATIONS = {
    "!cv/plantilla/",
    "!documents/**/.gitkeep",
    "!tracker/.gitkeep",
}

FORBIDDEN_SCRIPTS = {"preinstall", "install", "postinstall", "prepare", "prepack"}


def check_gitignore() -> None:
    path = ROOT / ".gitignore"
    try:
        lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines()]
    except OSError as exc:
        errors.append(f".gitignore: unreadable: {exc}")
        return
    rules = set(lines)
    for rule in REQUIRED_IGNORE_RULES:
        if rule not in rules:
            errors.append(
                f".gitignore: required personal-data rule missing: {rule!r}. "
                "Update REQUIRED_IGNORE_RULES in tools/security_guards.py in the "
                "same PR if the rule was renamed intentionally."
            )
    for line in lines:
        if line.startswith("!") and line not in ALLOWED_IGNORE_NEGATIONS:
            errors.append(
                f".gitignore: negation rule not in the reviewed allowlist: {line!r}. "
                "Add it to ALLOWED_IGNORE_NEGATIONS in tools/security_guards.py if intentional."
            )


def check_package_manifests() -> None:
    manifests = [
        p for p in ROOT.glob(".agents/**/package.json") if "node_modules" not in p.parts
    ]
    if not manifests:
        errors.append(".agents: no package.json files found - glob roots are wrong or the tree moved")
    for manifest in manifests:
        relpath = manifest.relative_to(ROOT)
        try:
            data = json.loads(manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            errors.append(f"{relpath}: unreadable or invalid JSON: {exc}")
            continue
        if not isinstance(data, dict):
            errors.append(f"{relpath}: top-level JSON value must be an object")
            continue
        scripts = data.get("scripts", {})
        if not isinstance(scripts, dict):
            errors.append(f"{relpath}: scripts must be an object")
            continue
        bad = FORBIDDEN_SCRIPTS & set(scripts)
        if bad:
            errors.append(f"{relpath}: lifecycle script(s) {sorted(bad)} are forbidden.")
        if "trustedDependencies" in data:
            errors.append(f"{relpath}: trustedDependencies is forbidden.")


def main() -> int:
    check_gitignore()
    check_package_manifests()
    if errors:
        print(f"security_guards: {len(errors)} failure(s)")
        for err in errors:
            print(f"  - {err}")
        return 1
    print("security_guards: OK (gitignore rules, package manifests)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
