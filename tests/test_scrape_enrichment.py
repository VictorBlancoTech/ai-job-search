"""Tests for ATS/email enrichment in the scrape normalizer."""

from job_scraper.run_scrape import normalize_row
from tools.rank_safety import validate_latest_payload


def test_normalize_row_enriches_fields():
    """normalize_row must set email_contacto and ats_hostil on every row."""
    row = normalize_row(
        {
            "id": "1",
            "title": "IT Manager",
            "company": "Acme",
            "location": "Bologna",
            "url": "https://company.workday.com/job/123",
            "date": "2026-07-23",
            "description": "Send CV to hr@acme.com",
            "salary": None,
        },
        "linkedin",
        "it-linkedin-01",
    )
    assert row["email_contacto"] == "hr@acme.com"
    assert row["ats_hostil"] is True

    row = normalize_row(
        {
            "id": "2",
            "title": "IT Manager",
            "company": "Acme",
            "location": None,
            "url": None,
            "date": None,
            "description": None,
            "salary": None,
        },
        "adzuna",
        "it-adzuna-01",
    )
    assert row["email_contacto"] is None
    assert row["ats_hostil"] is False


def test_new_fields_pass_validation():
    """A result with email_contacto and ats_hostil must pass validate_latest_payload."""
    payload = {
        "run_id": "20260723T000000Z-1",
        "generated_at": "2026-07-23T00:00:00Z",
        "results": [
            {
                "id": "1",
                "portal": "test",
                "title": "IT Manager",
                "company": "Acme",
                "location": "Bologna",
                "url": "https://company.workday.com/job/123",
                "date": "2026-07-23",
                "description": "Send CV to hr@acme.com",
                "remote": None,
                "salary": None,
                "source_call": "call-1",
                "new": True,
                "source_ids": ["test:1"],
                "duplicate_sources": ["test"],
                "email_contacto": "hr@acme.com",
                "ats_hostil": True,
            }
        ],
        "failures": [],
        "counts": {"results": 1},
    }
    errors = validate_latest_payload(payload)
    assert errors == [], f"unexpected validation errors: {errors}"
