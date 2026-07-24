#!/usr/bin/env python3
"""Pick first 10 safe candidates and write them to /tmp for the orchestrator."""
import json
import re
from pathlib import Path

LATEST = Path("job_scraper/latest.json")
LIMIT = 10

data = json.loads(LATEST.read_text())
results = [r for r in data.get("results", []) if r.get("new")]

picks = []
for row in results:
    portal = row.get("portal")
    rid = row.get("id")
    url = row.get("url")
    if not isinstance(portal, str) or not isinstance(rid, str):
        continue
    if not isinstance(url, str) or not url:
        continue
    safe_id = re.fullmatch(r"[A-Za-z0-9._:-]+", rid or "")
    if not safe_id or not any(c.isalnum() for c in (rid or "")):
        continue
    job_key = f"{portal}:{rid}"
    picks.append((job_key, row))
    if len(picks) >= LIMIT:
        break

out = []
for job_key, row in picks:
    safe = {
        "job_key": job_key,
        "id": row.get("id"),
        "portal": row.get("portal"),
        "title": row.get("title"),
        "company": row.get("company"),
        "location": row.get("location"),
        "date": row.get("date"),
        "description": row.get("description"),
        "salary": row.get("salary"),
        "remote": row.get("remote"),
        "source_call": row.get("source_call"),
        "source_ids": row.get("source_ids"),
        "duplicate_sources": row.get("duplicate_sources"),
        "url": row.get("url"),
    }
    out.append(safe)

Path("/tmp/rank_candidates.json").write_text(json.dumps(out, ensure_ascii=False, indent=2))
print("picked", len(out))
for s in out:
    print(s["job_key"], "|", s["title"], "|", s["location"], "|", s["date"], "|", s["url"][:60])
