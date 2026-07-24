"""Tests for parallel wave generation in tools/build_rank_batches.py."""

import json
import sys
from pathlib import Path

import pytest


def _make_candidates(n):
    return [
        {
            "job_key": f"test:{i}",
            "id": str(i),
            "portal": "test",
            "title": f"Role {i}",
            "company": "Acme",
            "location": "Bologna",
            "url": f"https://acme.example/job/{i}",
            "date": "2026-07-23",
            "description": "Job description.",
            "remote": None,
            "salary": None,
            "source_call": "call-1",
            "new": True,
            "source_ids": [f"test:{i}"],
            "duplicate_sources": ["test"],
        }
        for i in range(n)
    ]


def _run_build(tmp_path, monkeypatch, candidates, argv):
    import tools.build_rank_batches as brb
    cand_path = tmp_path / "candidates.json"
    out_path = tmp_path / "batches.json"
    cand_path.write_text(json.dumps(candidates))
    monkeypatch.setattr(brb, "CANDIDATES", cand_path)
    monkeypatch.setattr(brb, "OUT", out_path)
    monkeypatch.setattr(sys, "argv", argv)
    brb.main()
    return json.loads(out_path.read_text())


def test_default_waves_of_5_backwards_compatible(tmp_path, monkeypatch):
    """Without flags, keeps current behavior (waves of 5)."""
    payload = _run_build(
        tmp_path, monkeypatch, _make_candidates(12),
        ["build_rank_batches.py"],
    )
    assert len(payload["waves"]) == 3  # ceil(12/5)
    assert all(len(w) <= 5 for w in payload["waves"])


def test_parallel_3x50_splits_into_3_waves(tmp_path, monkeypatch):
    """135 candidates with --batch-size 50 --parallel 3 → 3 waves of ≤50."""
    payload = _run_build(
        tmp_path, monkeypatch, _make_candidates(135),
        ["build_rank_batches.py", "--batch-size", "50", "--parallel", "3"],
    )
    assert len(payload["waves"]) == 3
    assert all(len(w) <= 50 for w in payload["waves"])
    # balanced: each wave has 45
    assert sorted(len(w) for w in payload["waves"]) == [45, 45, 45]


def test_parallel_3x50_with_100_candidates_balances(tmp_path, monkeypatch):
    """100 candidates with 3 parallel slots → 3 waves balanced (~33 each)."""
    payload = _run_build(
        tmp_path, monkeypatch, _make_candidates(100),
        ["build_rank_batches.py", "--batch-size", "50", "--parallel", "3"],
    )
    assert len(payload["waves"]) == 3
    sizes = sorted(len(w) for w in payload["waves"])
    assert sizes == [33, 33, 34]
    assert all(len(w) <= 50 for w in payload["waves"])


def test_parallel_3x50_with_200_candidates_exceeds_capacity(tmp_path, monkeypatch):
    """200 candidates > 3*50 capacity → sequential chunks of 50, more than 3 waves."""
    payload = _run_build(
        tmp_path, monkeypatch, _make_candidates(200),
        ["build_rank_batches.py", "--batch-size", "50", "--parallel", "3"],
    )
    # 200/50 = 4 sequential waves (capacity exceeded)
    assert len(payload["waves"]) == 4
    assert all(len(w) <= 50 for w in payload["waves"])


def test_batch_size_caps_wave_size(tmp_path, monkeypatch):
    """--batch-size 30 --parallel 4 with 120 candidates → 4 waves of 30 each."""
    payload = _run_build(
        tmp_path, monkeypatch, _make_candidates(120),
        ["build_rank_batches.py", "--batch-size", "30", "--parallel", "4"],
    )
    assert len(payload["waves"]) == 4
    assert all(len(w) <= 30 for w in payload["waves"])
    assert sorted(len(w) for w in payload["waves"]) == [30, 30, 30, 30]
