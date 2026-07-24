#!/usr/bin/env python3
"""Pick all safe candidates (new=true) and write them to /tmp/rank_candidates_all.json.

Same gate as pick_candidates.py: portal/id must match the safe identifier regex;
url must be a non-empty string. No 10-cap. Used for the autonomous full-rank run.
URLs that fail is_safe_apply_url are excluded and recorded separately.
"""
import json
import re
import sys
from pathlib import Path

LATEST = Path("job_scraper/latest.json")
OUT = Path("/tmp/rank_candidates_all.json")
SKIPPED = Path("/tmp/rank_candidates_skipped.json")

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.rank_safety import is_safe_apply_url  # noqa: E402

SAFE_ID = re.compile(r"^[A-Za-z0-9._:-]+$")

data = json.loads(LATEST.read_text())
results = [r for r in data.get("results", []) if r.get("new")]

picks = []
skipped = []
for row in results:
    portal = row.get("portal")
    rid = row.get("id")
    url = row.get("url")
    if not isinstance(portal, str) or not isinstance(rid, str):
        continue
    if not isinstance(url, str) or not url:
        continue
    if not SAFE_ID.fullmatch(rid or ""):
        continue
    if not any(c.isalnum() for c in (rid or "")):
        continue
    if not is_safe_apply_url(url):
        skipped.append({"job_key": f"{portal}:{rid}", "reason": "unsafe_apply_url", "url": url})
        continue
    picks.append({
        "job_key": f"{portal}:{rid}",
        "id": rid,
        "portal": portal,
        "title": row.get("title"),
        "company": row.get("company"),
        "location": row.get("location"),
        "date": row.get("date"),
        "description": row.get("description"),
        "salary": row.get("salary"),
        "remote": row.get("remote"),
        "source_call": row.get("source_call"),
        "source_ids": list(row.get("source_ids") or []),
        "duplicate_sources": list(row.get("duplicate_sources") or []),
        "url": url,
    })

OUT.write_text(json.dumps(picks, ensure_ascii=False))
SKIPPED.write_text(json.dumps(skipped, ensure_ascii=False, indent=2))
print("picked", len(picks), "skipped", len(skipped))

