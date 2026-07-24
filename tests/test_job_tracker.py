from datetime import date
from pathlib import Path
from subprocess import CompletedProcess
from unittest.mock import patch

import pytest

from tools.job_tracker import (
    TRACKER_HEADERS,
    followup_gate,
    main,
    record_followup,
    record_outcome,
    render_secondbrain_note,
    sync_markdown,
    upsert_application,
)


def test_upsert_and_record_outcome_update_csv_and_archive(tmp_path: Path):
    cv = tmp_path / "cv_variant.tex"
    cv.write_text("CV draft", encoding="utf-8")

    row = upsert_application(
        tmp_path,
        {
            "empresa": "Acme SRL",
            "rol": "Responsabile IT",
            "portal": "linkedin",
            "url": "https://example.com/jobs/123",
            "tier": "A+",
            "score": "8.4",
            "estado": "applied",
        },
        today=date(2026, 7, 22),
    )

    result = record_outcome(
        tmp_path,
        {
            "empresa": "Acme SRL",
            "rol": "Responsabile IT",
            "status": "interview",
            "notes": "Phone screen scheduled.",
            "stages": ["Phone screen"],
            "artifacts": [str(cv)],
        },
        today=date(2026, 7, 25),
    )

    assert row["fecha"] == "2026-07-22"
    assert result["row"]["estado"] == "interview"
    assert result["row"]["próxima acción"] == "Preparar entrevista"
    assert result["application_dir"].joinpath("cv_variant.tex").exists()
    assert result["outcome_path"].exists()
    assert result["note_path"].exists()

    tracker = (tmp_path / "tracker" / "job_search_tracker.csv").read_text(encoding="utf-8")
    assert tracker.splitlines()[0].split(",") == list(TRACKER_HEADERS)
    assert "interview" in tracker
    assert "Phone screen scheduled." in tracker
    outcome = result["outcome_path"].read_text(encoding="utf-8")
    assert "**Status:** interview" in outcome
    assert "Phone screen" in outcome


def test_secondbrain_note_is_generated_from_tracker_row():
    note = render_secondbrain_note(
        {
            "empresa": "Acme SRL",
            "rol": "Responsabile IT",
            "portal": "linkedin",
            "url": "https://example.com/jobs/123",
            "tier": "A+",
            "score": "8.4",
            "estado": "applied",
            "fecha": "2026-07-22",
            "próxima acción": "Esperar confirmación",
            "notas": "",
        },
        {"updated": "2026-07-22", "resolved": "", "notes": ""},
    )

    assert 'estado: "applied"' in note
    assert 'score: "8.4"' in note
    assert "tags: [job-search]" in note
    assert "Acme SRL" in note
    assert "Responsabile IT" in note


def test_followup_requires_ten_days_and_is_capped_at_two(tmp_path: Path):
    record_outcome(
        tmp_path,
        {
            "empresa": "Acme SRL",
            "rol": "Responsabile IT",
            "status": "applied",
        },
        today=date(2026, 7, 1),
    )

    with pytest.raises(ValueError, match="10 días"):
        followup_gate(tmp_path, "Acme SRL", "Responsabile IT", 1, today=date(2026, 7, 10))

    first = record_followup(
        tmp_path,
        "Acme SRL",
        "Responsabile IT",
        1,
        "Draft follow-up",
        today=date(2026, 7, 11),
    )
    assert first["path"].name == "followup_1.md"
    assert "Draft follow-up" in first["path"].read_text(encoding="utf-8")

    second = record_followup(
        tmp_path,
        "Acme SRL",
        "Responsabile IT",
        2,
        "Second draft",
        today=date(2026, 7, 21),
    )
    assert second["path"].name == "followup_2.md"

    with pytest.raises(ValueError, match="Maximum two follow-ups"):
        followup_gate(tmp_path, "Acme SRL", "Responsabile IT", 3, today=date(2026, 7, 31))


def test_secondbrain_sync_uses_local_destination_or_ignored_queue(tmp_path: Path):
    source = tmp_path / "note.md"
    source.write_text("generated note", encoding="utf-8")
    vault = tmp_path / "vault"

    local = sync_markdown(
        tmp_path,
        source,
        "Projects/Job-Search/acme.md",
        env={"SECONDBRAIN_PATH": str(vault)},
    )
    assert local["mode"] == "local"
    assert (vault / "Projects/Job-Search/acme.md").read_text(encoding="utf-8") == "generated note"

    queued = sync_markdown(tmp_path, source, "Projects/Job-Search/queued.md", env={})
    assert queued["mode"] == "queued"
    assert queued["path"].read_text(encoding="utf-8") == "generated note"


def test_secondbrain_remote_sync_creates_parent_then_copies(tmp_path: Path):
    source = tmp_path / "note.md"
    source.write_text("generated note", encoding="utf-8")

    with patch(
        "tools.job_tracker.subprocess.run",
        side_effect=[
            CompletedProcess(["ssh"], 0),
            CompletedProcess(["scp"], 0),
        ],
    ) as run:
        result = sync_markdown(
            tmp_path,
            source,
            "Projects/Job-Search/acme.md",
            env={
                "SECONDBRAIN_SSH": "victor@example.test",
                "SECONDBRAIN_PATH": "/vault/SecondBrain",
            },
        )

    assert result["mode"] == "remote"
    assert run.call_args_list[0].args[0][:3] == [
        "ssh",
        "victor@example.test",
        "mkdir -p -- /vault/SecondBrain/Projects/Job-Search",
    ]
    assert run.call_args_list[1].args[0][:2] == ["scp", str(source)]


def test_cli_accepts_root_after_subcommand(tmp_path: Path, capsys):
    assert (
        main(
            [
                "outcome",
                "--root",
                str(tmp_path),
                "--company",
                "Acme SRL",
                "--role",
                "Responsabile IT",
                "--status",
                "applied",
            ]
        )
        == 0
    )
    assert '"estado": "applied"' in capsys.readouterr().out
