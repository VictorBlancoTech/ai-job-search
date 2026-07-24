#!/usr/bin/env python3
"""Render a Spanish digest table from job_scraper/latest.json.

New rows first, then seen, with strict date-descending and stable tiebreak
(title, company, portal, id). Null dates go last. No score, no description.
"""
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
LATEST = REPO / "job_scraper" / "latest.json"
ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def sort_key(r):
    dv = r.get("date") or ""
    if ISO.fullmatch(dv or ""):
        neg = -int(dv.replace("-", ""))
    else:
        neg = 1
    return (neg, r.get("title") or "", r.get("company") or "", r.get("portal") or "", r.get("id") or "")


def main():
    data = json.loads(LATEST.read_text())
    res = data.get("results", [])
    new = sorted([r for r in res if r.get("new")], key=sort_key)
    seen = sorted([r for r in res if not r.get("new")], key=sort_key)
    dash = "\u2014"
    lines = [
        "| # | Score pendiente | Título | Empresa | Ubicación | Portal | Fecha | New |",
        "|---:|---|---|---|---|---|---|---|",
    ]
    for i, r in enumerate(new + seen, 1):
        title = r.get("title") or dash
        url = r.get("url") or ""
        if url:
            title = f"[{title}]({url})"
        company = r.get("company") or dash
        location = r.get("location") or dash
        portal = r.get("portal") or dash
        date = r.get("date") or dash
        flag = "sí" if r.get("new") else "no"
        lines.append(f"| {i} | pendiente | {title} | {company} | {location} | {portal} | {date} | {flag} |")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
