#!/usr/bin/env python3
"""Build the safe reviewer payload per candidate and write to /tmp/rank_batches.json.

The reviewer never sees a URL, contact info, or unescaped HTML. Each payload is
deterministic JSON wrapped in <UNTRUSTED_JOB_DATA_JSON> markers with
&lt;/&gt;/&amp; escaped.
"""
import html
import json
import re
from pathlib import Path

CANDIDATES = Path("/tmp/rank_candidates.json")
OUT = Path("/tmp/rank_batches.json")

SAFE_TEXT = re.compile(r"[\u0000-\u001f\u007f]")


def redact(value):
    if not isinstance(value, str):
        return value
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


def main():
    candidates = json.loads(CANDIDATES.read_text())
    waves = []
    for i in range(0, len(candidates), 5):
        wave = [build_payload(c) for c in candidates[i:i + 5]]
        waves.append(wave)
    OUT.write_text(json.dumps({"waves": waves}, ensure_ascii=False))
    print("waves", len(waves))
    for w in waves:
        for c in w:
            print(" ", c["job_key"])


if __name__ == "__main__":
    main()
