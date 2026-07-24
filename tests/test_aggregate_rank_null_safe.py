"""Tests for None-safe aggregation in tools/aggregate_rank.py."""

import json
from pathlib import Path

import pytest


def _write_payloads(tmp_path, candidates, outputs, latest):
    (tmp_path / "rank_candidates.json").write_text(json.dumps(candidates))
    (tmp_path / "reviewer_outputs.json").write_text(json.dumps(outputs))
    (tmp_path / "latest.json").write_text(json.dumps(latest))


def _run_aggregate(tmp_path, monkeypatch):
    """Run aggregate_rank.main() with /tmp paths redirected to tmp_path."""
    import tools.aggregate_rank as agg
    monkeypatch.setattr(agg, "CANDIDATES", tmp_path / "rank_candidates.json")
    monkeypatch.setattr(agg, "OUTPUTS", tmp_path / "reviewer_outputs.json")
    monkeypatch.setattr(agg, "LATEST_PAYLOAD", tmp_path / "latest.json")
    monkeypatch.setattr(agg, "RANK_RUNS", tmp_path / "rank_runs")
    monkeypatch.setattr(agg, "JOB_SCRAPER", tmp_path)
    agg.main()
    return json.loads((tmp_path / "latest-rank.json").read_text())


def _valid_candidate(**overrides):
    base = {
        "job_key": "test:1",
        "id": "1",
        "portal": "test",
        "title": "IT Manager",
        "company": "Acme",
        "location": "Bologna",
        "url": "https://acme.example/job/1",
        "date": "2026-07-23",
        "description": "We are hiring.",
        "remote": None,
        "salary": None,
        "source_call": "call-1",
        "new": True,
        "source_ids": ["test:1"],
        "duplicate_sources": ["test"],
    }
    base.update(overrides)
    return base


def _valid_reviewer(job_key="test:1"):
    return {
        "job_key": job_key,
        "score": 7.5,
        "tier": "A",
        "verdict": "APLICAR",
        "strengths": ["a", "b", "c"],
        "gaps": ["x", "y", "z"],
        "salary": "no declarado",
        "notes": "Solid fit.",
    }


def _latest(run_id="20260723T000000Z-1"):
    return {
        "run_id": run_id,
        "generated_at": "2026-07-23T00:00:00Z",
        "results": [],
        "failures": [],
        "counts": {"results": 0},
    }


def test_candidate_with_null_title_goes_to_failures(tmp_path, monkeypatch):
    cand = _valid_candidate(title=None)
    out = {"by_job_key": {"test:1": {"attempts": 1, "payload": _valid_reviewer()}}}
    _write_payloads(tmp_path, [cand], out, _latest())
    payload = _run_aggregate(tmp_path, monkeypatch)
    assert payload["ranks"] == []
    assert len(payload["failures"]) == 1
    assert payload["failures"][0]["code"] == "RANK_FIELD_NULL"
    assert "title" in payload["failures"][0]["reason"]


def test_candidate_with_null_location_goes_to_failures(tmp_path, monkeypatch):
    cand = _valid_candidate(location=None)
    out = {"by_job_key": {"test:1": {"attempts": 1, "payload": _valid_reviewer()}}}
    _write_payloads(tmp_path, [cand], out, _latest())
    payload = _run_aggregate(tmp_path, monkeypatch)
    assert payload["ranks"] == []
    assert payload["failures"][0]["code"] == "RANK_FIELD_NULL"


def test_valid_candidate_passes_unchanged(tmp_path, monkeypatch):
    cand = _valid_candidate()
    out = {"by_job_key": {"test:1": {"attempts": 1, "payload": _valid_reviewer()}}}
    _write_payloads(tmp_path, [cand], out, _latest())
    payload = _run_aggregate(tmp_path, monkeypatch)
    assert len(payload["ranks"]) == 1
    assert payload["failures"] == []


def test_more_than_30_percent_failures_aborts(tmp_path, monkeypatch, capsys):
    """If >30% of candidates fail, aggregate must abort (no latest-rank written)."""
    cands = [_valid_candidate(job_key=f"test:{i}", id=str(i)) for i in range(10)]
    cands[0]["title"] = None
    cands[1]["title"] = None
    cands[2]["title"] = None
    out = {"by_job_key": {
        f"test:{i}": {"attempts": 1, "payload": _valid_reviewer(job_key=f"test:{i}")}
        for i in range(3, 9)
    }}
    _write_payloads(tmp_path, cands, out, _latest())
    with pytest.raises(SystemExit):
        _run_aggregate(tmp_path, monkeypatch)
    captured = capsys.readouterr()
    assert "failure rate" in captured.out.lower() or "abort" in captured.out.lower()
