#!/usr/bin/env python3
"""Orchestrator for /job-scrape - rule 6 default matrix (41 invocations).

Runs 12 IT + 9 ES + 15 EU + 5 worldwide CLI calls in parallel, normalizes
results, deduplicates by canonical URL and title+company, updates seen_jobs.json
and writes latest.json atomically. Presents a Spanish digest.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.rank_safety import detect_ats_hostil, extract_contact_email  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
JOB_SCRAPER = REPO / "job_scraper"
# Use relative paths from REPO for CLI args so import.meta.dir resolves .env correctly
SKILLS = Path(".agents") / "skills"

# ---------------------------------------------------------------------------
# Date normalization (section 5)
# ---------------------------------------------------------------------------

_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def normalize_date(raw):
    """Return YYYY-MM-DD or None. Never returns a raw timestamp."""
    if not isinstance(raw, str) or not raw.strip():
        return None
    raw = raw.strip()
    # Already YYYY-MM-DD
    if _ISO_DATE_RE.match(raw):
        try:
            datetime.strptime(raw, "%Y-%m-%d")
            return raw
        except ValueError:
            return None
    # Try ISO-8601 timestamp
    try:
        # Handle trailing Z
        candidate = raw.replace("Z", "+00:00") if raw.endswith("Z") else raw
        dt = datetime.fromisoformat(candidate)
        return dt.strftime("%Y-%m-%d")
    except (ValueError, TypeError):
        pass
    # Try other common formats as a last resort
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y/%m/%d", "%d/%m/%Y", "%m/%d/%Y"):
        try:
            dt = datetime.strptime(raw[:19] if "T" in raw else raw, fmt)
            return dt.strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


# ---------------------------------------------------------------------------
# Key normalization (section 6)
# ---------------------------------------------------------------------------

_MARK_RE = re.compile(r"\p{M}", re.UNICODE) if hasattr(re, r"\p{M}") else None


def normalize_key_part(s):
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^\w]", " ", s, flags=re.UNICODE)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def canonical_url(raw):
    if not isinstance(raw, str):
        return None
    try:
        parsed = urllib.parse.urlparse(raw)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = parsed.hostname or ""
    host = host.lower()
    path = parsed.path or ""
    # normalize trailing slash
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    elif path == "":
        path = "/"
    # query params
    query_pairs = []
    if parsed.query:
        for k, v in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True):
            kl = k.lower()
            if kl.startswith("utm_") or kl == "trk":
                continue
            query_pairs.append((kl, v))
    query_pairs.sort()
    query = urllib.parse.urlencode(query_pairs) if query_pairs else ""
    # fragment removed
    netloc = host
    if parsed.port:
        netloc = f"{host}:{parsed.port}"
    return urllib.parse.urlunparse((parsed.scheme, netloc, path, "", query, ""))


def title_company_key(row):
    title = normalize_key_part(row.get("title"))
    company = normalize_key_part(row.get("company"))
    if not title or not company:
        return None
    return title + "\u0000" + company


# ---------------------------------------------------------------------------
# Call definitions (rule 6 default matrix)
# ---------------------------------------------------------------------------

BOLOGNA_TOP3 = ["Responsabile IT", "Responsabile ICT", "IT Manager"]
COAST_CITIES = ["Rimini", "Ravenna", "Livorno", "Genova", "Bari"]
SPAIN_QUERIES = [
    "Consultor transformación digital",
    "Responsable IT",
    "Consultor IA automatización pymes",
]
EU_QUERIES = ["AI Automation Specialist", "AI Solutions Consultant", "IT Manager remote"]
WORLDWIDE_QUERY = "AI Automation Specialist"


def build_calls():
    """Return list of (call_id, portal, args_list) for the 41 default calls."""
    calls = []

    # --- Italy: 12 calls ---
    # Bologna top 3 on Adzuna IT (3)
    for i, q in enumerate(BOLOGNA_TOP3, 1):
        calls.append((
            f"it-adzuna-{i:02d}",
            "adzuna",
            ["bun", "run", str(SKILLS / "adzuna-search/cli/src/cli.ts"), "search",
             "-q", q, "-l", "Bologna, Emilia-Romagna", "--country", "it",
             "--limit", "15", "--format", "json"],
        ))
    # Bologna top 3 on LinkedIn (3)
    for i, q in enumerate(BOLOGNA_TOP3, 1):
        calls.append((
            f"it-linkedin-{i:02d}",
            "linkedin",
            ["bun", "run", str(SKILLS / "linkedin-search/cli/src/cli.ts"), "search",
             "-q", q, "-l", "Bologna", "--limit", "15", "--format", "json"],
        ))
    # Coast cities on Adzuna IT (5)
    for i, city in enumerate(COAST_CITIES, 1):
        calls.append((
            f"it-adzuna-coast-{i:02d}",
            "adzuna",
            ["bun", "run", str(SKILLS / "adzuna-search/cli/src/cli.ts"), "search",
             "-q", "Responsabile IT", "-l", city, "--country", "it",
             "--limit", "15", "--format", "json"],
        ))
    # Pass IT without location (1)
    calls.append((
        "it-adzuna-pass-01",
        "adzuna",
        ["bun", "run", str(SKILLS / "adzuna-search/cli/src/cli.ts"), "search",
         "-q", "IT Manager", "--country", "it", "--limit", "15", "--format", "json"],
    ))

    # --- Spain: 9 calls ---
    for i, q in enumerate(SPAIN_QUERIES, 1):
        calls.append((
            f"es-adzuna-{i:02d}",
            "adzuna",
            ["bun", "run", str(SKILLS / "adzuna-search/cli/src/cli.ts"), "search",
             "-q", q, "-l", "España", "--country", "es",
             "--limit", "15", "--format", "json"],
        ))
        calls.append((
            f"es-infojobs-{i:02d}",
            "infojobs",
            ["bun", "run", str(SKILLS / "infojobs-search/cli/src/cli.ts"), "search",
             "-q", q, "--teleworking", "--limit", "15", "--format", "json"],
        ))
        calls.append((
            f"es-linkedin-{i:02d}",
            "linkedin",
            ["bun", "run", str(SKILLS / "linkedin-search/cli/src/cli.ts"), "search",
             "-q", q, "-l", "Spain", "--remote", "remote",
             "--limit", "15", "--format", "json"],
        ))

    # --- EU remote: 15 calls (3 queries x 5 sources) ---
    for i, q in enumerate(EU_QUERIES, 1):
        calls.append((
            f"eu-remotive-{i:02d}",
            "remotive",
            ["bun", "run", str(SKILLS / "remotive-search/cli/src/cli.ts"), "search",
             "-q", q, "--limit", "15", "--format", "json"],
        ))
        calls.append((
            f"eu-remoteok-{i:02d}",
            "remoteok",
            ["bun", "run", str(SKILLS / "remoteok-search/cli/src/cli.ts"), "search",
             "-q", q, "--limit", "15", "--format", "json"],
        ))
        calls.append((
            f"eu-arbeitnow-{i:02d}",
            "arbeitnow",
            ["bun", "run", str(SKILLS / "arbeitnow-search/cli/src/cli.ts"), "search",
             "-q", q, "--remote-only", "--limit", "15", "--format", "json"],
        ))
        calls.append((
            f"eu-wwr-{i:02d}",
            "wwr",
            ["bun", "run", str(SKILLS / "wwr-search/cli/src/cli.ts"), "search",
             "-q", q, "--source", "both", "--limit", "15", "--format", "json"],
        ))
        calls.append((
            f"eu-freehire-{i:02d}",
            "freehire",
            ["bun", "run", str(SKILLS / "freehire-search/cli/src/cli.ts"), "search",
             "-q", q, "--remote", "remote", "--region", "eu",
             "--limit", "15", "--format", "json"],
        ))

    # --- Worldwide: 5 calls (1 query x 5 sources) ---
    calls.append((
        "ww-remotive-01",
        "remotive",
        ["bun", "run", str(SKILLS / "remotive-search/cli/src/cli.ts"), "search",
         "-q", WORLDWIDE_QUERY, "--limit", "15", "--format", "json"],
    ))
    calls.append((
        "ww-remoteok-01",
        "remoteok",
        ["bun", "run", str(SKILLS / "remoteok-search/cli/src/cli.ts"), "search",
         "-q", WORLDWIDE_QUERY, "--limit", "15", "--format", "json"],
    ))
    calls.append((
        "ww-arbeitnow-01",
        "arbeitnow",
        ["bun", "run", str(SKILLS / "arbeitnow-search/cli/src/cli.ts"), "search",
         "-q", WORLDWIDE_QUERY, "--remote-only", "--limit", "15", "--format", "json"],
    ))
    calls.append((
        "ww-wwr-01",
        "wwr",
        ["bun", "run", str(SKILLS / "wwr-search/cli/src/cli.ts"), "search",
         "-q", WORLDWIDE_QUERY, "--source", "both", "--limit", "15", "--format", "json"],
    ))
    calls.append((
        "ww-freehire-01",
        "freehire",
        ["bun", "run", str(SKILLS / "freehire-search/cli/src/cli.ts"), "search",
         "-q", WORLDWIDE_QUERY, "--remote", "remote",
         "--limit", "15", "--format", "json"],
    ))

    return calls


# ---------------------------------------------------------------------------
# Run a single CLI call
# ---------------------------------------------------------------------------

def run_call(call_id, portal, args, raw_dir, error_dir):
    raw_path = raw_dir / f"{call_id}.json"
    err_path = error_dir / f"{call_id}.stderr"
    try:
        proc = subprocess.run(
            args,
            cwd=str(REPO),
            capture_output=True,
            text=True,
            timeout=120,
        )
        raw_path.write_text(proc.stdout or "")
        err_path.write_text(proc.stderr or "")
        return call_id, portal, proc.returncode, None
    except subprocess.TimeoutExpired:
        raw_path.write_text("")
        err_path.write_text(json.dumps({"code": "TIMEOUT", "message": "CLI exceeded 120s"}))
        return call_id, portal, 124, "TIMEOUT"
    except Exception as e:
        raw_path.write_text("")
        err_path.write_text(str(e))
        return call_id, portal, 1, str(e)


# ---------------------------------------------------------------------------
# Parse and normalize results per portal
# ---------------------------------------------------------------------------

def parse_call(call_id, portal, exit_code, raw_dir, error_dir):
    """Return (rows, failure_dict_or_None)."""
    raw_path = raw_dir / f"{call_id}.json"
    err_path = error_dir / f"{call_id}.stderr"
    raw_file = str(raw_path.relative_to(REPO))
    stderr_file = str(err_path.relative_to(REPO))

    if exit_code != 0:
        code = f"PROCESS_EXIT_{exit_code}"
        message = ""
        # Try to extract JSON code from stderr
        try:
            err_text = err_path.read_text()
            # Look for JSON in stderr
            err_json = json.loads(err_text)
            if isinstance(err_json, dict) and "code" in err_json:
                code = err_json["code"]
                message = err_json.get("message", "")
        except (json.JSONDecodeError, ValueError):
            pass
        is_expected = code in ("NO_CREDENTIALS",)
        return [], {
            "call_id": call_id,
            "portal": portal,
            "code": code,
            "message": message,
            "exit_code": exit_code,
            "raw_file": raw_file,
            "stderr_file": stderr_file,
            "expected": is_expected,
        }

    # Exit code 0: parse stdout
    try:
        raw_text = raw_path.read_text()
    except Exception:
        return [], {
            "call_id": call_id, "portal": portal, "code": "MALFORMED_JSON",
            "message": "could not read raw file", "exit_code": 0,
            "raw_file": raw_file, "stderr_file": stderr_file, "expected": False,
        }

    if not raw_text.strip():
        return [], {
            "call_id": call_id, "portal": portal, "code": "MALFORMED_JSON",
            "message": "empty stdout", "exit_code": 0,
            "raw_file": raw_file, "stderr_file": stderr_file, "expected": False,
        }

    try:
        data = json.loads(raw_text)
    except (json.JSONDecodeError, ValueError):
        return [], {
            "call_id": call_id, "portal": portal, "code": "MALFORMED_JSON",
            "message": "stdout is not valid JSON", "exit_code": 0,
            "raw_file": raw_file, "stderr_file": stderr_file, "expected": False,
        }

    if not isinstance(data, dict):
        return [], {
            "call_id": call_id, "portal": portal, "code": "INVALID_ENVELOPE",
            "message": "root is not an object", "exit_code": 0,
            "raw_file": raw_file, "stderr_file": stderr_file, "expected": False,
        }

    results = data.get("results")
    if not isinstance(results, list):
        return [], {
            "call_id": call_id, "portal": portal, "code": "INVALID_ENVELOPE",
            "message": "results is missing or not an array", "exit_code": 0,
            "raw_file": raw_file, "stderr_file": stderr_file, "expected": False,
        }

    rows = []
    for item in results:
        if not isinstance(item, dict):
            continue
        row = normalize_row(item, portal, call_id)
        if row is not None:
            rows.append(row)

    return rows, None


def normalize_row(item, portal, call_id):
    """Map a raw result item to the normalized schema."""
    row_id = item.get("id")
    if row_id is not None:
        row_id = str(row_id) if not isinstance(row_id, str) else row_id

    title = item.get("title")
    company = item.get("company")
    location = item.get("location")
    url = item.get("url")
    date_raw = item.get("date")
    description = item.get("description")
    salary = item.get("salary")

    # Portal-specific remote handling
    remote = None
    if portal == "adzuna":
        remote = None  # Adzuna always returns null per contract
    elif portal == "freehire":
        wm = item.get("work_mode")
        if wm == "remote":
            remote = True
        elif wm == "onsite":
            remote = False
        else:
            remote = None
    elif portal in ("remotive", "remoteok", "wwr"):
        remote = True  # These are remote-only sources
    elif portal == "arbeitnow":
        remote = bool(item.get("remote", False)) if item.get("remote") is not None else None
    elif portal == "linkedin":
        remote = None  # Leave null unless explicitly in card
    elif portal == "infojobs":
        remote = None

    # WWR portal field: keep only wwr or himalayas
    if portal == "wwr":
        p = item.get("portal")
        if p in ("wwr", "himalayas"):
            portal = p

    return {
        "id": row_id,
        "portal": portal,
        "title": title if isinstance(title, str) else None,
        "company": company if isinstance(company, str) else None,
        "location": location if isinstance(location, str) else None,
        "url": url if isinstance(url, str) else None,
        "date": normalize_date(date_raw),
        "description": description if isinstance(description, str) else None,
        "remote": remote,
        "salary": salary if isinstance(salary, str) else None,
        "source_call": call_id,
        "new": False,
        "email_contacto": extract_contact_email(description),
        "ats_hostil": detect_ats_hostil(url),
    }


# ---------------------------------------------------------------------------
# Seen state management
# ---------------------------------------------------------------------------

def load_seen_state():
    """Load and validate seen_jobs.json. Returns (seen_dict, backup_info_or_None)."""
    seen_path = JOB_SCRAPER / "seen_jobs.json"
    backup_info = None

    if not seen_path.exists():
        return {}, None

    try:
        data = json.loads(seen_path.read_text())
    except (json.JSONDecodeError, ValueError):
        # Corrupt JSON
        backup_info = backup_seen_file(seen_path, "STATE_RESET_CORRUPT")
        return {}, backup_info

    if not isinstance(data, dict):
        backup_info = backup_seen_file(seen_path, "STATE_RESET_CORRUPT")
        return {}, backup_info

    version = data.get("version")
    seen = data.get("seen")

    if version != 1 or not isinstance(seen, dict):
        code = "STATE_UNSUPPORTED_VERSION" if version != 1 else "STATE_RESET_CORRUPT"
        backup_info = backup_seen_file(seen_path, code)
        return {}, backup_info

    return seen, None


def backup_seen_file(seen_path, code):
    """Atomically rename corrupt seen_jobs.json. Returns dict with backup info."""
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = JOB_SCRAPER / f"seen_jobs.corrupt.{timestamp}.json"
    if backup_path.exists():
        # Add suffix
        i = 1
        while True:
            backup_path = JOB_SCRAPER / f"seen_jobs.corrupt.{timestamp}.{i}.json"
            if not backup_path.exists():
                break
            i += 1
    try:
        seen_path.rename(backup_path)
        return {
            "code": code,
            "backup_file": str(backup_path.relative_to(REPO)),
        }
    except Exception:
        return {
            "code": "STATE_BACKUP_FAILED",
            "backup_file": None,
        }


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def deduplicate(rows, seen_snapshot):
    """Deduplicate rows by canonical URL and title+company.

    Returns (deduped_groups, dedup_count, new_seen_keys).
    """
    url_index = {}   # canonical_url -> group_id
    title_company_index = {}  # titleCompanyKey -> group_id
    groups = {}  # group_id -> {"primary": row, "members": [rows], "sources": [], "source_ids": []}
    next_group_id = 0
    dedup_count = 0

    for row in rows:
        # Compute constituent_new: is this portal:id new vs snapshot?
        seen_key = None
        if row["id"] is not None and row["portal"] is not None:
            seen_key = f"{row['portal']}:{row['id']}"
        constituent_new = seen_key is not None and seen_key not in seen_snapshot

        # Compute dedup keys
        cu = canonical_url(row.get("url"))
        tck = title_company_key(row)

        # Find matching groups
        matched_group_ids = set()
        if cu is not None and cu in url_index:
            matched_group_ids.add(url_index[cu])
        if tck is not None and tck in title_company_index:
            matched_group_ids.add(title_company_index[tck])

        if not matched_group_ids:
            # New group
            gid = next_group_id
            next_group_id += 1
            groups[gid] = {
                "primary": row,
                "members": [row],
                "sources": [row["portal"]] if row["portal"] else [],
                "source_ids": [seen_key] if seen_key else [],
                "constituent_new_flags": [constituent_new],
            }
            if cu is not None:
                url_index[cu] = gid
            if tck is not None:
                title_company_index[tck] = gid
        else:
            # Merge into the group with the smallest id
            target_gid = min(matched_group_ids)
            # If multiple groups matched, merge them transitively
            for gid in matched_group_ids:
                if gid == target_gid:
                    continue
                # Merge gid into target_gid
                src_group = groups.pop(gid)
                groups[target_gid]["members"].extend(src_group["members"])
                groups[target_gid]["sources"].extend(src_group["sources"])
                groups[target_gid]["source_ids"].extend(src_group["source_ids"])
                groups[target_gid]["constituent_new_flags"].extend(src_group["constituent_new_flags"])
                # Re-register all keys from merged group to target
                # We need to re-scan all members
                # (we'll do a full re-index below)
            # Add current row to target group
            groups[target_gid]["members"].append(row)
            if row["portal"] and row["portal"] not in groups[target_gid]["sources"]:
                groups[target_gid]["sources"].append(row["portal"])
            if seen_key and seen_key not in groups[target_gid]["source_ids"]:
                groups[target_gid]["source_ids"].append(seen_key)
            groups[target_gid]["constituent_new_flags"].append(constituent_new)
            # Re-index all members of the target group
            # First remove old index entries pointing to absorbed groups
            # (they were already popped, but indices may still point to old gids)
            # Rebuild indices for this group
            for m in groups[target_gid]["members"]:
                mc = canonical_url(m.get("url"))
                mt = title_company_key(m)
                if mc is not None:
                    url_index[mc] = target_gid
                if mt is not None:
                    title_company_index[mt] = target_gid

    # Now finalize groups
    deduped = []
    new_seen_keys = set()
    for gid, group in groups.items():
        primary = group["primary"]
        # group.new is true if any member has constituent_new=True
        group_new = any(group["constituent_new_flags"])
        primary["new"] = group_new
        # Collect all seen keys for this group
        for member in group["members"]:
            if member["id"] is not None and member["portal"] is not None:
                sk = f"{member['portal']}:{member['id']}"
                new_seen_keys.add(sk)
        # Add dedup metadata
        primary["duplicate_sources"] = group["sources"]
        primary["source_ids"] = group["source_ids"]
        deduped.append(primary)
        if len(group["members"]) > 1:
            dedup_count += len(group["members"]) - 1

    return deduped, dedup_count, new_seen_keys


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Generate RUN_ID
    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + f"-{os.getpid()}"
    run_dir = JOB_SCRAPER / "runs" / run_id
    raw_dir = run_dir / "raw"
    error_dir = run_dir / "errors"
    raw_dir.mkdir(parents=True, exist_ok=True)
    error_dir.mkdir(parents=True, exist_ok=True)

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Load seen state
    seen_snapshot, state_backup = load_seen_state()
    state_failures = []
    if state_backup:
        state_failures.append({
            "call_id": "state",
            "portal": "state",
            "code": state_backup.get("code", "STATE_RESET_CORRUPT"),
            "message": "seen_jobs.json was corrupt or unsupported; reset to empty",
            "exit_code": 0,
            "raw_file": "",
            "stderr_file": "",
            "expected": False,
        })
        if state_backup.get("backup_file"):
            state_failures[-1]["backup_file"] = state_backup["backup_file"]

    # Build calls
    calls = build_calls()
    assert len(calls) == 41, f"Expected 41 calls, got {len(calls)}"

    # Run all calls in parallel
    results_map = {}  # call_id -> (portal, exit_code)
    with ThreadPoolExecutor(max_workers=41) as executor:
        futures = {
            executor.submit(run_call, cid, portal, args, raw_dir, error_dir): cid
            for cid, portal, args in calls
        }
        for future in as_completed(futures):
            call_id, portal, exit_code, err = future.result()
            results_map[call_id] = (portal, exit_code)

    # Parse all results
    all_rows = []
    all_failures = list(state_failures)
    successful_calls = 0
    failed_calls = 0
    skipped_calls = 0

    for call_id, portal, args in calls:
        exit_code = results_map[call_id][1]
        rows, failure = parse_call(call_id, portal, exit_code, raw_dir, error_dir)
        if failure:
            all_failures.append(failure)
            if failure.get("expected"):
                skipped_calls += 1
            else:
                failed_calls += 1
        else:
            successful_calls += 1
            all_rows.extend(rows)

    raw_results = len(all_rows)

    # Deduplicate
    deduped, dedup_count, new_seen_keys = deduplicate(all_rows, seen_snapshot)

    # Count new vs seen
    new_count = sum(1 for r in deduped if r.get("new"))
    seen_count = len(deduped) - new_count

    # Update seen state: preserve old keys, add new ones
    updated_seen = dict(seen_snapshot)
    for sk in new_seen_keys:
        if sk not in updated_seen:
            updated_seen[sk] = generated_at

    # Write seen_jobs.json atomically (only if no STATE_BACKUP_FAILED)
    state_backup_failed = any(
        f.get("code") == "STATE_BACKUP_FAILED" for f in state_failures
    )
    if not state_backup_failed:
        seen_path = JOB_SCRAPER / "seen_jobs.json"
        tmp_seen = seen_path.with_suffix(".json.tmp")
        tmp_seen.write_text(json.dumps({"version": 1, "seen": updated_seen}, ensure_ascii=False, indent=2))
        os.replace(tmp_seen, seen_path)

    # Sort results: new first, then date desc, nulls last, stable tiebreak
    def sort_key(r):
        is_new = 0 if r.get("new") else 1
        date_val = r.get("date") or ""
        # null dates go last (within new/seen group)
        date_sort = (1, "") if not date_val else (0, date_val)
        # For descending date, we'll reverse, so use negative-ish approach
        return (is_new, 0 if date_val else 1, _invert_date(date_val), r.get("title") or "", r.get("company") or "", r.get("portal") or "", r.get("id") or "")

    def _invert_date(d):
        # For descending sort within ascending framework, negate by using complement
        if not d:
            return ""
        # Use a sortable inverted string: for descending, we can sort by negative
        # Simpler: sort all by (is_new, date_missing, -date, title...)
        return d  # We'll handle descending differently

    # Simpler sort: new first, then date desc (nulls last), then stable tiebreak
    def sort_key_v2(r):
        is_new = 0 if r.get("new") else 1
        date_val = r.get("date")
        if date_val:
            # For descending, we negate the date string by inverting chars
            # But easier: sort ascending and reverse within group
            return (is_new, 0, date_val, r.get("title") or "", r.get("company") or "", r.get("portal") or "", r.get("id") or "")
        else:
            return (is_new, 1, "", r.get("title") or "", r.get("company") or "", r.get("portal") or "", r.get("id") or "")

    # Sort new first, then by date descending
    deduped_new = [r for r in deduped if r.get("new")]
    deduped_seen = [r for r in deduped if not r.get("new")]

    def sort_date_desc(r):
        date_val = r.get("date") or ""
        return (-ord_sort(date_val), r.get("title") or "", r.get("company") or "", r.get("portal") or "", r.get("id") or "")

    def ord_sort(s):
        # Convert date string to a sortable integer (higher = more recent = first)
        if not s:
            return 0
        try:
            return int(s.replace("-", ""))
        except ValueError:
            return 0

    # Sort: date descending (higher ord_sort first), nulls last, stable tiebreak
    deduped_new.sort(key=lambda r: (-ord_sort(r.get("date") or ""), r.get("title") or "", r.get("company") or "", r.get("portal") or "", r.get("id") or ""))
    deduped_seen.sort(key=lambda r: (-ord_sort(r.get("date") or ""), r.get("title") or "", r.get("company") or "", r.get("portal") or "", r.get("id") or ""))

    deduped_sorted = deduped_new + deduped_seen

    # Prepare results for latest.json (strip internal fields)
    results_out = []
    for r in deduped_sorted:
        result = {
            "id": r.get("id"),
            "portal": r.get("portal"),
            "title": r.get("title"),
            "company": r.get("company"),
            "location": r.get("location"),
            "url": r.get("url"),
            "date": r.get("date"),
            "description": r.get("description"),
            "remote": r.get("remote"),
            "salary": r.get("salary"),
            "source_call": r.get("source_call"),
            "new": r.get("new", False),
            "email_contacto": r.get("email_contacto"),
            "ats_hostil": r.get("ats_hostil", False),
        }
        if "duplicate_sources" in r:
            result["duplicate_sources"] = r["duplicate_sources"]
        if "source_ids" in r:
            result["source_ids"] = r["source_ids"]
        results_out.append(result)

    # Build latest.json
    latest = {
        "run_id": run_id,
        "generated_at": generated_at,
        "results": results_out,
        "failures": all_failures,
        "counts": {
            "calls": len(calls),
            "successful_calls": successful_calls,
            "failed_calls": failed_calls,
            "skipped_calls": skipped_calls,
            "raw_results": raw_results,
            "normalized_results": len(deduped_sorted),
            "deduplicated": dedup_count,
            "results": len(deduped_sorted),
            "new": new_count,
            "seen": seen_count,
            "failures": len(all_failures),
            "skipped": skipped_calls,
        },
    }

    # Write latest.json atomically
    latest_path = JOB_SCRAPER / "latest.json"
    tmp_latest = latest_path.with_suffix(".json.tmp")
    tmp_latest.write_text(json.dumps(latest, ensure_ascii=False, indent=2))
    os.replace(tmp_latest, latest_path)

    # Print summary for the digest
    print(json.dumps({
        "run_id": run_id,
        "generated_at": generated_at,
        "counts": latest["counts"],
        "results_count": len(results_out),
        "failures_count": len(all_failures),
        "new_results": [r for r in results_out if r.get("new")],
        "seen_results": [r for r in results_out if not r.get("new")],
        "failures": all_failures,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()