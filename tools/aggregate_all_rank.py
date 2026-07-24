#!/usr/bin/env python3
"""Save batched reviewer outputs and aggregate everything into the final rank.

Reads /tmp/batched_responses/responses.json (list of {wave_idx, results, attempts})
and /tmp/reviewer_outputs_w0_w1.json (single-offer outputs from waves 0+1).
"""
import json
import re
import sys
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.rank_safety import (  # noqa: E402
    contains_contact_pattern,
    redact_contacts,
    sanitize_reviewer_output,
)

REPO = Path(__file__).resolve().parents[1]
JOB_SCRAPER = REPO / "job_scraper"
RANK_RUNS = JOB_SCRAPER / "rank_runs"
LATEST_PAYLOAD = JOB_SCRAPER / "latest.json"
CANDIDATES = Path("/tmp/rank_candidates_all.json")
BATCHED_RESPONSES = Path("/tmp/batched_responses/responses.json")
SINGLE_RESPONSES = Path("/tmp/reviewer_outputs_w0_w1.json")
SKIPPED_FILE = Path("/tmp/rank_candidates_skipped.json")

ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIER_ORDER = {"A+": 0, "A": 1, "B+": 2, "B": 3, "C": 4, "VETO": 5}


def normalise_text(s):
    if not isinstance(s, str):
        return ""
    decomposed = unicodedata.normalize("NFKD", s)
    no_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    cleaned = "".join(c if (c.isalnum()) else " " for c in no_marks.lower())
    return " ".join(cleaned.split())


def sort_rank_key(rank):
    return (
        -float(rank["score"]),
        TIER_ORDER.get(rank["tier"], 99),
        normalise_text(rank.get("title", "")),
        normalise_text(rank.get("company", "")),
        rank.get("job_key", ""),
    )


def main():
    candidates = {c["job_key"]: c for c in json.loads(CANDIDATES.read_text())}
    skipped = json.loads(SKIPPED_FILE.read_text()) if SKIPPED_FILE.exists() else []

    by_job_key = {}
    if SINGLE_RESPONSES.exists():
        single = json.loads(SINGLE_RESPONSES.read_text()).get("by_job_key", {})
        for jk, entry in single.items():
            by_job_key[jk] = {
                "payload": entry.get("payload"),
                "attempts": entry.get("attempts", 1),
            }

    if BATCHED_RESPONSES.exists():
        batched = json.loads(BATCHED_RESPONSES.read_text())
        for wave in batched.get("wave_responses", []):
            results = wave.get("results") or []
            attempts = wave.get("attempts", 1)
            for r in results:
                jk = r.get("job_key")
                if not jk:
                    continue
                by_job_key[jk] = {"payload": r, "attempts": attempts}

    source = json.loads(LATEST_PAYLOAD.read_text())
    source_run_id = source.get("run_id")
    if not isinstance(source_run_id, str) or not source_run_id:
        raise SystemExit("missing run_id in latest.json")

    valid = []
    failures = []
    processed = set()
    for job_key, candidate in candidates.items():
        entry = by_job_key.get(job_key)
        if entry is None:
            failures.append({"job_key": job_key, "code": "RANK_FAILED", "attempts": 0, "reason": "missing_output"})
            continue
        processed.add(job_key)
        attempts = int(entry.get("attempts", 1))
        payload = entry.get("payload")
        try:
            sanitized = sanitize_reviewer_output(payload, expected_job_key=job_key)
        except (ValueError, TypeError) as exc:
            failures.append({
                "job_key": job_key,
                "code": "RANK_FAILED",
                "attempts": attempts,
                "reason": "invalid_reviewer_output",
                "detail": str(exc)[:120],
            })
            continue
        meta = {
            "title": redact_contacts(candidate.get("title")),
            "company": redact_contacts(candidate.get("company")),
            "location": redact_contacts(candidate.get("location")),
        }
        if any(
            meta[f] and contains_contact_pattern(meta[f])
            for f in ("title", "company", "location")
        ):
            failures.append({"job_key": job_key, "code": "RANK_FAILED", "attempts": attempts, "reason": "contact_pattern_remaining"})
            continue
        rank = {
            "job_key": sanitized["job_key"],
            "score": sanitized["score"],
            "tier": sanitized["tier"],
            "verdict": sanitized["verdict"],
            "strengths": sanitized["strengths"],
            "gaps": sanitized["gaps"],
            "salary": sanitized["salary"],
            "notes": sanitized["notes"],
            "title": candidate.get("title"),
            "company": candidate.get("company"),
            "location": candidate.get("location"),
            "url": candidate.get("url"),
            "date": candidate.get("date"),
            "remote": candidate.get("remote"),
            "portal": candidate.get("portal"),
            "source_ids": list(candidate.get("source_ids") or []),
            "duplicate_sources": list(candidate.get("duplicate_sources") or []),
        }
        valid.append(rank)

    for s in skipped:
        jk = s.get("job_key")
        if jk and jk not in processed:
            failures.append({
                "job_key": jk,
                "code": "RANK_INPUT_INVALID",
                "attempts": 0,
                "reason": "unsafe_apply_url",
            })

    valid.sort(key=sort_rank_key)
    failures.sort(key=lambda f: f["job_key"])

    run_id = (
        "rank-MERGED-"
        + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    )
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    payload = {
        "version": 1,
        "run_id": run_id,
        "generated_at": generated_at,
        "source_run_id": source_run_id,
        "ranks": valid,
        "failures": failures,
    }

    RANK_RUNS.mkdir(parents=True, exist_ok=True)
    rank_path = RANK_RUNS / f"{run_id}.json"
    tmp_rank = rank_path.with_suffix(".json.tmp")
    tmp_rank.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    tmp_rank.replace(rank_path)

    latest_path = JOB_SCRAPER / "latest-rank.json"
    tmp_latest = latest_path.with_suffix(".json.tmp")
    tmp_latest.write_text(json.dumps(payload, ensure_ascii=False, indent=2))
    tmp_latest.replace(latest_path)

    print("run_id", run_id)
    print("candidates", len(candidates))
    print("ranked", len(valid))
    print("failures", len(failures))
    print("verdicts", dict(sorted({(r["verdict"], sum(1 for x in valid if x["verdict"] == r["verdict"])) for r in valid})))
    print("tiers", dict(sorted({(r["tier"], sum(1 for x in valid if x["tier"] == r["tier"])) for r in valid})))
    print("top5", [(r["job_key"], r["score"], r["tier"], r["verdict"]) for r in valid[:5]])


if __name__ == "__main__":
    main()
