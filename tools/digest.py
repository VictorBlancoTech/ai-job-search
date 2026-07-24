#!/usr/bin/env python3
"""Render the deterministic daily digest from the latest rank artifact."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import date
from pathlib import Path
from typing import Any, Mapping, Sequence

try:
    from tools.job_tracker import _atomic_write, sync_markdown
except ModuleNotFoundError:  # Direct execution: python3 tools/digest.py
    from job_tracker import _atomic_write, sync_markdown


def _cell(value: Any) -> str:
    if value is None or value == "":
        return "—"
    return str(value).replace("|", "\\|").replace("\n", " ").strip()


def _validate_payload(payload: Any) -> Mapping[str, Any]:
    if not isinstance(payload, dict):
        raise ValueError("latest-rank.json debe ser un objeto")
    if not isinstance(payload.get("ranks"), list) or not isinstance(payload.get("failures"), list):
        raise ValueError("latest-rank.json no contiene ranks y failures válidos")
    return payload


def render_digest(payload: Mapping[str, Any], day: str, *, limit: int = 10) -> str:
    payload = _validate_payload(payload)
    ranks = payload["ranks"][:limit]
    failures = payload["failures"]
    lines = [
        f"# Job Search Digest — {day}",
        "",
        f"**Rank:** {_cell(payload.get('run_id'))}",
        f"**Scrape:** {_cell(payload.get('source_run_id'))}",
        "",
        "## Prioridad",
        "",
        "| # | Score | Tier | Veredicto | Rol | Empresa | Ubicación | Portal | URL |",
        "|---:|---:|---|---|---|---|---|---|---|",
    ]
    for index, rank in enumerate(ranks, start=1):
        lines.append(
            "| "
            + " | ".join(
                [
                    str(index),
                    _cell(rank.get("score")),
                    _cell(rank.get("tier")),
                    _cell(rank.get("verdict")),
                    _cell(rank.get("title")),
                    _cell(rank.get("company")),
                    _cell(rank.get("location")),
                    _cell(rank.get("portal")),
                    _cell(rank.get("url")),
                ]
            )
            + " |"
        )
    if not ranks:
        lines.append("| — | — | — | No hay ranks válidos | — | — | — | — | — |")

    lines.extend(["", "## Próxima acción", ""])
    if ranks:
        for rank in ranks:
            if rank.get("verdict") == "APLICAR":
                lines.append(
                    f"- Revisar `/job-apply` para **{_cell(rank.get('title'))}** en **{_cell(rank.get('company'))}**."
                )
            elif rank.get("verdict") == "APLICAR SI SOBRA TIEMPO":
                lines.append(
                    f"- Mantener en cola: **{_cell(rank.get('title'))}** en **{_cell(rank.get('company'))}**."
                )
    else:
        lines.append("- Ejecutar otra búsqueda o revisar las credenciales de los portales.")

    lines.extend(["", "## Fallos", ""])
    if failures:
        for failure in failures:
            lines.append(
                f"- `{_cell(failure.get('job_key', failure.get('call_id', 'unknown')))}`: "
                f"`{_cell(failure.get('code', 'UNKNOWN'))}` {_cell(failure.get('reason', failure.get('message', '')))}"
            )
    else:
        lines.append("- Ninguno.")
    lines.extend(["", "_Generado automáticamente a partir de `latest-rank.json`; no se envía ninguna candidatura._", ""])
    return "\n".join(lines)


def write_digest(
    root: Path | str,
    *,
    rank_file: Path | str | None = None,
    day: str | None = None,
    sync: bool = True,
) -> dict[str, Any]:
    root_path = Path(root).expanduser().resolve()
    rank_path = Path(rank_file) if rank_file else root_path / "job_scraper" / "latest-rank.json"
    if not rank_path.is_absolute():
        rank_path = root_path / rank_path
    if not rank_path.exists():
        raise ValueError("no existe job_scraper/latest-rank.json; ejecuta /job-rank primero")
    try:
        payload = json.loads(rank_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError("latest-rank.json no es JSON válido") from exc
    digest_day = day or date.today().isoformat()
    content = render_digest(payload, digest_day)
    output = root_path / "tracker" / "digests" / f"{digest_day}.md"
    _atomic_write(output, content)
    result: dict[str, Any] = {"path": output, "day": digest_day}
    if sync:
        result["sync"] = sync_markdown(
            root_path,
            output,
            Path("Projects") / "Job-Search" / "digest" / f"{digest_day}.md",
        )
    return result


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".")
    parser.add_argument("--rank-file", default=None)
    parser.add_argument("--date", default=None)
    parser.add_argument("--no-sync", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = write_digest(
            args.root,
            rank_file=args.rank_file,
            day=args.date,
            sync=not args.no_sync,
        )
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc), "code": "DIGEST_INVALID"}), file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
