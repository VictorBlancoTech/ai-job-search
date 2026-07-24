#!/usr/bin/env python3
"""Deterministic tracker, application archive, and SecondBrain helpers.

The CSV is the source of truth. Markdown files are generated views and local
artifacts, so a failed vault sync never loses the tracker update.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import posixpath
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unicodedata
from datetime import date
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


TRACKER_HEADERS = (
    "fecha",
    "empresa",
    "rol",
    "portal",
    "url",
    "tier",
    "score",
    "estado",
    "próxima acción",
    "notas",
)

VALID_STATUSES = {
    "draft",
    "applied",
    "in_progress",
    "interview",
    "offer",
    "hired",
    "offer_declined",
    "rejected",
    "no_response",
}

FINAL_STATUSES = {"hired", "offer_declined", "rejected", "no_response"}
FOLLOWUP_STATUSES = {"applied", "in_progress", "interview"}

NEXT_ACTIONS = {
    "draft": "Revisar y decidir si aplicar",
    "applied": "Esperar confirmación / preparar seguimiento",
    "in_progress": "Esperar próxima etapa",
    "interview": "Preparar entrevista",
    "offer": "Revisar oferta",
    "hired": "Cerrar búsqueda",
    "offer_declined": "Registrar motivo y calibrar",
    "rejected": "Registrar feedback y calibrar",
    "no_response": "Registrar cierre y calibrar",
}

STAGES = (
    "Phone screen",
    "Technical interview",
    "Case interview",
    "Final round",
    "Offer received",
)


def _root(root: Path | str | None) -> Path:
    return Path(root or Path.cwd()).expanduser().resolve()


def _today(value: date | str | None) -> date:
    if value is None:
        return date.today()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def _clean(value: Any, *, single_line: bool = False) -> str:
    text = "" if value is None else str(value)
    text = text.replace("\x00", "").strip()
    if single_line:
        text = re.sub(r"\s+", " ", text)
    return text


def _yaml_quote(value: Any) -> str:
    return json.dumps(_clean(value), ensure_ascii=False)


def slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", _clean(value, single_line=True))
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9]+", "_", ascii_value).strip("_").lower()
    return slug[:120] or "application"


def application_slug(company: str, role: str) -> str:
    return f"{slugify(company)}_{slugify(role)}"


def application_dir(root: Path | str, company: str, role: str) -> Path:
    return _root(root) / "tracker" / "aplicaciones" / application_slug(company, role)


def tracker_path(root: Path | str) -> Path:
    return _root(root) / "tracker" / "job_search_tracker.csv"


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="", dir=path.parent, delete=False
    ) as handle:
        temporary = Path(handle.name)
        handle.write(content)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    os.chmod(path, 0o600)


def _write_csv(path: Path, rows: Sequence[Mapping[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="", dir=path.parent, delete=False
    ) as handle:
        temporary = Path(handle.name)
        writer = csv.DictWriter(handle, fieldnames=TRACKER_HEADERS, extrasaction="raise")
        writer.writeheader()
        writer.writerows({field: row.get(field, "") for field in TRACKER_HEADERS} for row in rows)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    os.chmod(path, 0o600)


def load_tracker(root: Path | str) -> list[dict[str, str]]:
    path = tracker_path(root)
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != TRACKER_HEADERS:
            raise ValueError("job_search_tracker.csv tiene cabeceras incompatibles")
        return [
            {field: _clean(row.get(field, "")) for field in TRACKER_HEADERS}
            for row in reader
            if any(_clean(value) for value in row.values())
        ]


def _row_matches(row: Mapping[str, str], details: Mapping[str, Any]) -> bool:
    url = _clean(details.get("url"))
    if url and row.get("url"):
        return row["url"].strip() == url
    return (
        row.get("empresa", "").casefold() == _clean(details.get("empresa"), single_line=True).casefold()
        and row.get("rol", "").casefold() == _clean(details.get("rol"), single_line=True).casefold()
    )


def _find_row_index(rows: Sequence[Mapping[str, str]], details: Mapping[str, Any]) -> int | None:
    url = _clean(details.get("url"))
    if url:
        exact_url = next(
            (i for i, row in enumerate(rows) if row.get("url", "").strip() == url),
            None,
        )
        if exact_url is not None:
            return exact_url
    return next((i for i, row in enumerate(rows) if _row_matches(row, details)), None)


def _format_score(value: Any) -> str:
    if value in (None, ""):
        return ""
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("score debe ser un número entre 0 y 10") from exc
    if not math.isfinite(number) or not 0 <= number <= 10:
        raise ValueError("score debe ser un número entre 0 y 10")
    return f"{number:.1f}"


def _validate_status(status: str) -> str:
    status = _clean(status, single_line=True)
    if status not in VALID_STATUSES:
        valid = ", ".join(sorted(VALID_STATUSES))
        raise ValueError(f"estado inválido: {status!r}; valores válidos: {valid}")
    return status


def upsert_application(
    root: Path | str,
    details: Mapping[str, Any],
    *,
    today: date | str | None = None,
) -> dict[str, str]:
    """Create or update one row using URL, then company+role as identity."""

    company = _clean(details.get("empresa"), single_line=True)
    role = _clean(details.get("rol"), single_line=True)
    if not company or not role:
        raise ValueError("empresa y rol son obligatorios")

    rows = load_tracker(root)
    index = _find_row_index(rows, details)
    if index is None:
        row = {field: "" for field in TRACKER_HEADERS}
        row["fecha"] = _today(today).isoformat()
    else:
        row = rows[index].copy()

    row["empresa"] = company
    row["rol"] = role
    for field in ("portal", "url", "tier", "próxima acción", "notas"):
        if field in details and details[field] is not None:
            row[field] = _clean(details[field], single_line=field not in {"notas"})
    if "score" in details and details["score"] is not None:
        row["score"] = _format_score(details["score"])
    if "estado" in details and details["estado"] is not None:
        row["estado"] = _validate_status(details["estado"])
    elif not row["estado"]:
        row["estado"] = "draft"
    if not row["próxima acción"]:
        row["próxima acción"] = NEXT_ACTIONS[row["estado"]]

    if index is None:
        rows.append(row)
    else:
        rows[index] = row
    _write_csv(tracker_path(root), rows)
    return row


def _read_outcome_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "status": "",
            "resolved": "",
            "updated": "",
            "last_activity": "",
            "followups": 0,
            "notes": "",
            "stages": [],
        }
    text = path.read_text(encoding="utf-8")

    def field(name: str) -> str:
        match = re.search(rf"^\*\*{re.escape(name)}:\*\*\s*(.*)$", text, re.MULTILINE)
        return _clean(match.group(1)) if match else ""

    count_match = re.search(r"^\*\*Follow-ups drafted:\*\*\s*(\d+)", text, re.MULTILINE)
    notes_match = re.search(r"^## Notes\s*\n(.*?)(?=^## |\Z)", text, re.MULTILINE | re.DOTALL)
    stages = [
        stage
        for stage in STAGES
        if re.search(rf"^- \[x\] {re.escape(stage)}\s*$", text, re.MULTILINE)
    ]
    return {
        "status": field("Status"),
        "resolved": field("Date resolved"),
        "updated": field("Date updated"),
        "last_activity": field("Last activity") or field("Application date"),
        "followups": int(count_match.group(1)) if count_match else 0,
        "notes": _clean(notes_match.group(1)) if notes_match else "",
        "stages": stages,
    }


def _merge_notes(old: str, new: str, today: date) -> str:
    new = _clean(new)
    if not new:
        return old
    entry = f"{today.isoformat()}: {new}"
    return f"{old}\n{entry}".strip() if old else entry


def _validated_sources(root: Path, sources: Iterable[str | Path]) -> list[Path]:
    root = root.resolve()
    validated: list[Path] = []
    forbidden_roots = {".git", ".venv", "venv", "perfil"}
    for raw_source in sources:
        source = Path(raw_source).expanduser()
        if not source.is_absolute():
            source = root / source
        if source.is_symlink():
            raise ValueError(f"artifact no válido: {raw_source}")
        source = source.resolve()
        if not source.is_file():
            raise ValueError(f"artifact no válido: {raw_source}")
        try:
            relative = source.relative_to(root)
        except ValueError as exc:
            raise ValueError(f"artifact fuera del workspace: {raw_source}") from exc
        if relative.parts and relative.parts[0] in forbidden_roots or source.name == ".env":
            raise ValueError(f"artifact no permitido: {raw_source}")
        validated.append(source)
    return validated


def _archive_sources(root: Path, destination: Path, sources: Iterable[str | Path]) -> list[str]:
    destination.mkdir(parents=True, exist_ok=True)
    archived: list[str] = []
    for source in _validated_sources(root, sources):
        target = destination / source.name
        if source != target:
            shutil.copy2(source, target)
        archived.append(target.name)
    return archived


def render_outcome(
    row: Mapping[str, str],
    state: Mapping[str, Any],
) -> str:
    stages = set(state.get("stages", []))
    lines = [
        f"# Outcome: {row['empresa']} — {row['rol']}",
        "",
        f"**Status:** {state.get('status', row.get('estado', ''))}",
        f"**Date resolved:** {state.get('resolved', '')}",
        f"**Date updated:** {state.get('updated', '')}",
        f"**Application date:** {row.get('fecha', '')}",
        f"**Last activity:** {state.get('last_activity', '')}",
        f"**Follow-ups drafted:** {state.get('followups', 0)}",
        "",
        "## Interview stages reached",
    ]
    lines.extend(f"- [{'x' if stage in stages else ' '}] {stage}" for stage in STAGES)
    lines.extend(
        [
            "",
            "## Notes",
            state.get("notes", "") or "No notes recorded.",
            "",
        ]
    )
    return "\n".join(lines)


def render_secondbrain_note(row: Mapping[str, str], state: Mapping[str, Any]) -> str:
    resolved = state.get("resolved", "")
    notes = state.get("notes", "") or ""
    lines = [
        "---",
        f"empresa: {_yaml_quote(row.get('empresa', ''))}",
        f"rol: {_yaml_quote(row.get('rol', ''))}",
        f"estado: {_yaml_quote(row.get('estado', ''))}",
        f"score: {_yaml_quote(row.get('score', ''))}",
        f"tier: {_yaml_quote(row.get('tier', ''))}",
        f"portal: {_yaml_quote(row.get('portal', ''))}",
        f"fecha_aplicacion: {_yaml_quote(row.get('fecha', ''))}",
        f"fecha_actualizacion: {_yaml_quote(state.get('updated', ''))}",
        f"fecha_resolucion: {_yaml_quote(resolved)}",
        "tags: [job-search]",
        f"url: {_yaml_quote(row.get('url', ''))}",
        "---",
        f"# {row.get('empresa', '')} — {row.get('rol', '')}",
        "",
        f"**Estado:** {row.get('estado', '')}",
        f"**Próxima acción:** {row.get('próxima acción', '')}",
        "",
        "## Notas",
        notes or "Sin notas registradas.",
        "",
    ]
    return "\n".join(lines)


def record_outcome(
    root: Path | str,
    details: Mapping[str, Any],
    *,
    today: date | str | None = None,
) -> dict[str, Any]:
    root_path = _root(root)
    current_date = _today(today)
    status = _validate_status(details.get("status", ""))
    company = _clean(details.get("empresa"), single_line=True)
    role = _clean(details.get("rol"), single_line=True)
    app_dir = application_dir(root_path, company, role)
    previous = _read_outcome_state(app_dir / "outcome.md")
    artifacts = list(details.get("artifacts") or [])
    _validated_sources(root_path, artifacts)

    merged_notes = _merge_notes(previous.get("notes", ""), details.get("notes", ""), current_date)
    stages = list(dict.fromkeys([*previous.get("stages", []), *(details.get("stages") or [])]))
    row_details = dict(details)
    row_details["empresa"] = company
    row_details["rol"] = role
    row_details["estado"] = status
    row_details["próxima acción"] = details.get("next_action") or NEXT_ACTIONS[status]
    row_details["notas"] = merged_notes
    row = upsert_application(root_path, row_details, today=details.get("application_date") or current_date)

    resolved = _clean(details.get("resolved_date"))
    if status in FINAL_STATUSES and not resolved:
        resolved = current_date.isoformat()
    state = {
        "status": status,
        "resolved": resolved,
        "updated": current_date.isoformat(),
        "last_activity": current_date.isoformat(),
        "followups": int(previous.get("followups", 0)),
        "notes": merged_notes,
        "stages": stages,
    }
    app_dir.mkdir(parents=True, exist_ok=True)
    archived = _archive_sources(root_path, app_dir, artifacts)
    outcome_path = app_dir / "outcome.md"
    note_path = app_dir / "secondbrain.md"
    _atomic_write(outcome_path, render_outcome(row, state))
    _atomic_write(note_path, render_secondbrain_note(row, state))
    return {
        "row": row,
        "application_dir": app_dir,
        "outcome_path": outcome_path,
        "note_path": note_path,
        "archived": archived,
        "state": state,
    }


def followup_gate(
    root: Path | str,
    company: str,
    role: str,
    number: int,
    *,
    today: date | str | None = None,
) -> dict[str, Any]:
    if number not in (1, 2):
        raise ValueError("Maximum two follow-ups per application")
    root_path = _root(root)
    rows = load_tracker(root_path)
    details = {"empresa": company, "rol": role}
    row = next((candidate for candidate in rows if _row_matches(candidate, details)), None)
    if row is None:
        raise ValueError("aplicación no encontrada en el tracker")
    app_dir = application_dir(root_path, company, role)
    state = _read_outcome_state(app_dir / "outcome.md")
    if state.get("followups", 0) >= 2:
        raise ValueError("Maximum two follow-ups per application")
    if number != state.get("followups", 0) + 1:
        raise ValueError("los follow-ups deben numerarse consecutivamente")
    if row.get("estado") not in FOLLOWUP_STATUSES:
        raise ValueError("el estado actual no admite follow-up")
    last_activity = state.get("last_activity") or row.get("fecha")
    if not last_activity:
        raise ValueError("falta la fecha de la última actividad")
    elapsed = (_today(today) - date.fromisoformat(last_activity)).days
    if elapsed < 10:
        raise ValueError("deben pasar 10 días de silencio antes del follow-up")
    return {"row": row, "application_dir": app_dir, "state": state, "number": number}


def record_followup(
    root: Path | str,
    company: str,
    role: str,
    number: int,
    body: str,
    *,
    today: date | str | None = None,
) -> dict[str, Any]:
    root_path = _root(root)
    current_date = _today(today)
    gate = followup_gate(root_path, company, role, number, today=current_date)
    body = _clean(body)
    if not body:
        raise ValueError("el borrador del follow-up no puede estar vacío")
    path = gate["application_dir"] / f"followup_{number}.md"
    content = "\n".join(
        [
            "---",
            "tipo: follow-up",
            f"numero: {number}",
            "estado: draft",
            "no_send: true",
            f"fecha: {current_date.isoformat()}",
            "---",
            "",
            f"# Follow-up draft {number}",
            "",
            "draft only, never send",
            "",
            body,
            "",
        ]
    )
    _atomic_write(path, content)

    state = dict(gate["state"])
    state["followups"] = number
    state["updated"] = current_date.isoformat()
    state["last_activity"] = current_date.isoformat()
    state["notes"] = _merge_notes(
        state.get("notes", ""), f"follow-up {number} draft created; manual review required", current_date
    )
    row = upsert_application(
        root_path,
        {
            "empresa": company,
            "rol": role,
            "estado": gate["row"]["estado"],
            "próxima acción": "Revisar y enviar follow-up manual",
            "notas": state.get("notes", ""),
        },
        today=current_date,
    )
    outcome_path = gate["application_dir"] / "outcome.md"
    note_path = gate["application_dir"] / "secondbrain.md"
    _atomic_write(outcome_path, render_outcome(row, state))
    _atomic_write(note_path, render_secondbrain_note(row, state))
    return {"path": path, "outcome_path": outcome_path, "note_path": note_path, "state": state}


def load_env(root: Path | str) -> dict[str, str]:
    path = _root(root) / ".env"
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def _safe_relative_path(relative_path: str | Path) -> Path:
    path = Path(relative_path)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ValueError("ruta SecondBrain inválida")
    return path


def sync_markdown(
    root: Path | str,
    source: Path | str,
    relative_path: str | Path,
    *,
    env: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    """Sync a generated markdown file locally or through scp.

    A failed or unconfigured sync is queued under an ignored local directory.
    """

    root_path = _root(root)
    source_path_raw = Path(source).expanduser()
    if not source_path_raw.is_absolute():
        source_path_raw = root_path / source_path_raw
    if source_path_raw.is_symlink():
        raise ValueError("fuente SecondBrain no válida")
    source_path = source_path_raw.resolve()
    if not source_path.is_file():
        raise ValueError("fuente SecondBrain no válida")
    try:
        source_path.relative_to(root_path)
    except ValueError as exc:
        raise ValueError("fuente SecondBrain fuera del workspace") from exc
    relative = _safe_relative_path(relative_path)
    config = dict(load_env(root_path) if env is None else env)
    base = _clean(config.get("SECONDBRAIN_PATH"))
    ssh = _clean(config.get("SECONDBRAIN_SSH"), single_line=True)
    queue = root_path / "tracker" / "secondbrain-queue" / relative

    if not base:
        queue.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, queue)
        return {"mode": "queued", "reason": "not_configured", "path": queue}

    if ssh:
        if "\n" in ssh or "\r" in ssh or "\n" in base or "\r" in base:
            raise ValueError("configuración SecondBrain inválida")
        remote_parent = posixpath.join(base.rstrip("/"), relative.parent.as_posix())
        remote_target = f"{ssh}:{posixpath.join(base.rstrip('/'), relative.as_posix())}"
        mkdir_result = None
        completed = None
        try:
            mkdir_result = subprocess.run(
                ["ssh", ssh, f"mkdir -p -- {shlex.quote(remote_parent)}"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                timeout=60,
                check=False,
            )
            completed = subprocess.run(
                ["scp", str(source_path), remote_target],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                timeout=60,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            pass
        if (
            mkdir_result is not None
            and mkdir_result.returncode == 0
            and completed is not None
            and completed.returncode == 0
        ):
            return {"mode": "remote", "target": remote_target}
        queue.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, queue)
        return {"mode": "queued", "reason": "scp_failed", "path": queue}

    destination = Path(base).expanduser() / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, destination)
    return {"mode": "local", "path": destination}


def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"no JSON representation for {type(value).__name__}")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="workspace root")
    subparsers = parser.add_subparsers(dest="command", required=True)

    upsert = subparsers.add_parser("upsert")
    upsert.add_argument("--root", default=argparse.SUPPRESS)
    _add_application_args(upsert)

    outcome = subparsers.add_parser("outcome")
    outcome.add_argument("--root", default=argparse.SUPPRESS)
    _add_application_args(outcome)
    outcome.add_argument("--status", required=True)
    outcome.add_argument("--notes", default="")
    outcome.add_argument("--stage", action="append", default=[])
    outcome.add_argument("--artifact", action="append", default=[])
    outcome.add_argument("--resolved-date", default="")
    outcome.add_argument("--application-date", default="")
    outcome.add_argument("--sync-secondbrain", action="store_true")

    gate = subparsers.add_parser("followup-gate")
    gate.add_argument("--root", default=argparse.SUPPRESS)
    gate.add_argument("--company", required=True)
    gate.add_argument("--role", required=True)
    gate.add_argument("--number", required=True, type=int)
    gate.add_argument("--date", default="")

    followup = subparsers.add_parser("record-followup")
    followup.add_argument("--root", default=argparse.SUPPRESS)
    followup.add_argument("--company", required=True)
    followup.add_argument("--role", required=True)
    followup.add_argument("--number", required=True, type=int)
    followup.add_argument("--body-file", required=True)
    followup.add_argument("--date", default="")
    followup.add_argument("--sync-secondbrain", action="store_true")

    sync = subparsers.add_parser("sync")
    sync.add_argument("--root", default=argparse.SUPPRESS)
    sync.add_argument("--source", required=True)
    sync.add_argument("--relative-path", required=True)
    return parser


def _add_application_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--company", dest="empresa", required=True)
    parser.add_argument("--role", dest="rol", required=True)
    parser.add_argument("--portal", default=None)
    parser.add_argument("--url", default=None)
    parser.add_argument("--tier", default=None)
    parser.add_argument("--score", default=None)


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    root = _root(args.root)
    try:
        if args.command == "upsert":
            details = vars(args).copy()
            row = upsert_application(root, details)
            print(json.dumps(row, ensure_ascii=False))
        elif args.command == "outcome":
            details = {
                "empresa": args.empresa,
                "rol": args.rol,
                "portal": args.portal,
                "url": args.url,
                "tier": args.tier,
                "score": args.score,
                "status": args.status,
                "notes": args.notes,
                "stages": args.stage,
                "artifacts": args.artifact,
                "resolved_date": args.resolved_date,
                "application_date": args.application_date or None,
            }
            result = record_outcome(root, details)
            if args.sync_secondbrain:
                result["sync"] = sync_markdown(
                    root,
                    result["note_path"],
                    Path("Projects") / "Job-Search" / f"{application_slug(args.empresa, args.rol)}.md",
                )
            print(json.dumps(result, ensure_ascii=False, default=_json_default))
        elif args.command == "followup-gate":
            result = followup_gate(root, args.company, args.role, args.number, today=args.date or None)
            print(json.dumps(result, ensure_ascii=False, default=_json_default))
        elif args.command == "record-followup":
            body = Path(args.body_file).read_text(encoding="utf-8")
            result = record_followup(
                root,
                args.company,
                args.role,
                args.number,
                body,
                today=args.date or None,
            )
            if args.sync_secondbrain:
                result["sync"] = sync_markdown(
                    root,
                    result["note_path"],
                    Path("Projects") / "Job-Search" / f"{application_slug(args.company, args.role)}.md",
                )
            print(json.dumps(result, ensure_ascii=False, default=_json_default))
        elif args.command == "sync":
            result = sync_markdown(root, args.source, args.relative_path)
            print(json.dumps(result, ensure_ascii=False, default=_json_default))
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc), "code": "TRACKER_INVALID"}), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
