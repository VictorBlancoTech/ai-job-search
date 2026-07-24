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


def load_env():
    env = os.environ.copy()
    env_file = REPO / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                env[k.strip()] = v.strip()
    return env


def main():
    if not LATEST.exists():
        sys.exit("latest.json not found — run /job-scrape first")
    latest = json.loads(LATEST.read_text())
    existing = {normalize(r.get("title"), r.get("company")) for r in latest.get("results", [])}

    env = load_env()
    if not env.get("JSEARCH_API_KEY"):
        sys.exit("JSEARCH_API_KEY not set in .env")

    new_count = 0
    dup_count = 0
    errors = 0
    for query, location in QUERIES:
        cmd = [
            "bun", "run", ".agents/skills/jsearch-search/cli/src/cli.ts",
            "search", "-q", query,
        ]
        if location:
            cmd += ["-l", location]
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=REPO, env=env, timeout=60)
        if result.returncode != 0:
            print(f"SKIP {query!r}: exit {result.returncode}: {result.stderr[:100]}", file=sys.stderr)
            errors += 1
            continue
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError:
            print(f"SKIP {query!r}: invalid JSON output", file=sys.stderr)
            errors += 1
            continue
        for r in data.get("results", []):
            key = normalize(r.get("title"), r.get("company"))
            if key in existing:
                dup_count += 1
            else:
                new_count += 1

    total = new_count + dup_count
    print(f"JSearch evaluation over {len(QUERIES)} queries ({errors} errors):")
    print(f"  total results: {total}")
    print(f"  duplicates with existing pipeline: {dup_count}")
    print(f"  new offers: {new_count}")
    if total == 0:
        print("RECOMMENDATION: no data — check API key/quota")
        sys.exit(1)
    dup_pct = 100 * dup_count / total
    new_pct = 100 * new_count / total
    print(f"  overlap: {dup_pct:.0f}%  new: {new_pct:.0f}%")
    if dup_pct > 60:
        print("RECOMMENDATION: keep jsearch disabled (>60% overlap)")
    elif new_pct > 20:
        print("RECOMMENDATION: activate jsearch (adds >20% new offers) — flip enabled: true in SKILL.md")
    else:
        print("RECOMMENDATION: marginal — keep disabled unless quota is free")


if __name__ == "__main__":
    main()
