from tools.digest import render_digest


def test_render_digest_contains_only_rank_summary():
    payload = {
        "version": 1,
        "run_id": "rank-20260722T070000Z",
        "generated_at": "2026-07-22T07:03:00Z",
        "source_run_id": "scrape-20260722T070000Z",
        "ranks": [
            {
                "job_key": "linkedin:123",
                "score": 8.4,
                "tier": "A+",
                "verdict": "APLICAR",
                "title": "Responsabile IT",
                "company": "Acme SRL",
                "location": "Bologna",
                "portal": "linkedin",
                "url": "https://example.com/jobs/123",
                "salary": "50-60k EUR",
                "notes": "Good local fit",
            }
        ],
        "failures": [],
    }

    digest = render_digest(payload, "2026-07-22")

    assert digest.startswith("# Job Search Digest — 2026-07-22")
    assert "Responsabile IT" in digest
    assert "Acme SRL" in digest
    assert "8.4" in digest
    assert "https://example.com/jobs/123" in digest
    assert "description" not in digest
