#!/usr/bin/env python3
"""Build the safe reviewer payload per candidate and write to /tmp/rank_batches.json.

Default: waves of 5 (backwards compatible with the pre-parallel /job-rank).
With --batch-size M --parallel N: split candidates into N waves of ≤M each,
balanced (distribute remainder evenly). If candidates > N*M capacity, fall back
to sequential chunks of M (more than N waves).

The reviewer never sees a URL, contact info, or unescaped HTML. Each payload is
deterministic JSON wrapped in <UNTRUSTED_JOB_DATA_JSON> markers with
&lt;/&gt;/&amp; escaped.
"""
import argparse
import json
import re
from pathlib import Path

CANDIDATES = Path("/tmp/rank_candidates.json")
OUT = Path("/tmp/rank_batches.json")

SAFE_TEXT = re.compile(r"[\u0000-\u001f\u007f]")


def redact(value):
    return value


def escape(value):
    if not isinstance(value, str):
        return value
    if SAFE_TEXT.search(value):
        return None
    return (
        value.replace("&", "\\u0026")
        .replace("<", "\\u003C")
        .replace(">", "\\u003E")
    )


def build_payload(candidate):
    safe = {
        "job_key": candidate["job_key"],
        "id": candidate["id"],
        "portal": candidate["portal"],
        "title": escape(redact(candidate.get("title"))),
        "company": escape(redact(candidate.get("company"))),
        "location": escape(redact(candidate.get("location"))),
        "date": candidate.get("date"),
        "description": escape(redact(candidate.get("description"))),
        "salary": escape(redact(candidate.get("salary"))),
        "remote": candidate.get("remote"),
        "source_call": candidate.get("source_call"),
        "source_ids": list(candidate.get("source_ids") or []),
        "duplicate_sources": list(candidate.get("duplicate_sources") or []),
    }
    serialized = json.dumps(safe, ensure_ascii=False, indent=None, sort_keys=True)
    return {
        "job_key": candidate["job_key"],
        "title": candidate.get("title"),
        "company": candidate.get("company"),
        "url": candidate.get("url"),
        "block": (
            "<UNTRUSTED_JOB_DATA_JSON>\n"
            + serialized
            + "\n</UNTRUSTED_JOB_DATA_JSON>"
        ),
    }


def _split_waves(candidates, batch_size, parallel):
    """Split into `parallel` waves of ≤batch_size each, balanced.

    If len(candidates) > parallel*batch_size, fall back to sequential chunks
    of batch_size (more than `parallel` waves).
    """
    if parallel <= 0:
        parallel = 1
    if batch_size <= 0:
        batch_size = 5
    capacity = parallel * batch_size
    if len(candidates) <= capacity:
        base = len(candidates) // parallel
        extra = len(candidates) % parallel
        waves = []
        start = 0
        for i in range(parallel):
            size = base + (1 if i < extra else 0)
            if size == 0:
                continue
            waves.append(candidates[start:start + size])
            start += size
        return waves
    return [candidates[i:i + batch_size] for i in range(0, len(candidates), batch_size)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-size", type=int, default=5)
    parser.add_argument("--parallel", type=int, default=None)
    args = parser.parse_args()

    candidates = json.loads(CANDIDATES.read_text())

    if args.parallel is None:
        waves = [
            [build_payload(c) for c in candidates[i:i + 5]]
            for i in range(0, len(candidates), 5)
        ]
    else:
        grouped = _split_waves(candidates, args.batch_size, args.parallel)
        waves = [[build_payload(c) for c in wave] for wave in grouped]

    OUT.write_text(json.dumps({"waves": waves}, ensure_ascii=False))
    print("waves", len(waves))
    for w in waves:
        print(f"  wave size: {len(w)}")


if __name__ == "__main__":
    main()
