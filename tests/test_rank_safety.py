"""Executable safety tests for the /rank input and reviewer contracts."""

import copy

import pytest

from tools.rank_safety import (
    contains_contact_pattern,
    is_safe_apply_url,
    is_safe_identifier,
    normalize_strict_date,
    redact_contacts,
    sanitize_reviewer_output,
    validate_latest_payload,
)


def valid_latest_payload():
    return {
        "run_id": "20260722T120000Z-1234",
        "generated_at": "2026-07-22T12:00:00Z",
        "results": [
            {
                "id": "job-1",
                "portal": "freehire",
                "title": "AI Automation Consultant",
                "company": "Example Corp",
                "location": None,
                "url": "https://example.com/jobs/123",
                "date": "2026-07-06",
                "description": None,
                "remote": True,
                "salary": None,
                "source_call": "remote-freehire-01",
                "new": True,
                "source_ids": ["freehire:job-1"],
                "duplicate_sources": ["freehire"],
            }
        ],
        "failures": [],
        "counts": {
            "calls": 1,
            "successful_calls": 1,
            "failed_calls": 0,
            "skipped_calls": 0,
            "raw_results": 1,
            "normalized_results": 1,
            "deduplicated": 0,
            "results": 1,
            "new": 1,
            "seen": 0,
            "failures": 0,
            "skipped": 0,
        },
    }


def test_valid_freehire_latest_payload_is_accepted():
    assert validate_latest_payload(valid_latest_payload()) == []
    assert normalize_strict_date("2026-07-06T00:00:00Z") == "2026-07-06"


def test_strict_date_rejects_impossible_calendar_days():
    assert normalize_strict_date("2026-02-31") is None
    assert normalize_strict_date("2026-02-31T00:00:00Z") is None
    assert normalize_strict_date("2026-02-28") == "2026-02-28"
    assert normalize_strict_date("2024-02-29") == "2024-02-29"
    assert normalize_strict_date("2023-02-29") is None
    assert normalize_strict_date("2026-07-06X00:00:00") is None

    payload = valid_latest_payload()
    payload["results"][0]["date"] = "2026-02-31"
    assert any("date" in error for error in validate_latest_payload(payload))

    payload = valid_latest_payload()
    payload["generated_at"] = "2026-02-31T00:00:00Z"
    assert any("generated_at" in error for error in validate_latest_payload(payload))


@pytest.mark.parametrize(
    "value", ["job@1", "job 1", "<script>", "tel:+39324", ".", "..", ":", "---"]
)
def test_safe_identifier_rejects_markup_contact_and_whitespace(value):
    assert not is_safe_identifier(value)


def test_latest_rejects_malicious_identifiers_and_source_values():
    for field in ("id", "portal", "source_call"):
        payload = valid_latest_payload()
        payload["results"][0][field] = "bad@value"
        assert validate_latest_payload(payload)

    for field in ("source_ids", "duplicate_sources"):
        payload = valid_latest_payload()
        payload["results"][0][field] = ["bad value"]
        assert validate_latest_payload(payload)

    payload = valid_latest_payload()
    payload["results"][0]["job_key"] = "freehire:bad@value"
    assert validate_latest_payload(payload)


def test_latest_rejects_duplicate_derived_job_keys():
    payload = valid_latest_payload()
    payload["results"].append(copy.deepcopy(payload["results"][0]))
    payload["counts"]["results"] = 2

    errors = validate_latest_payload(payload)

    assert any("duplicate job key" in error for error in errors)


@pytest.mark.parametrize(
    "url",
    [
        "mailto:apply@example.com",
        "tel:+393249868002",
        "javascript:alert(1)",
        "data:text/html,hello",
        "https://example.com/contact/apply@example.com",
        "https://example.com/jobs/123-456-7890",
        "https://example.com/jobs/1234567?phone=%2B39%20324%20986%208002",
        "https://example.com/jobs/1234567#phone-%2B39%20324%20986%208002",
        "https://example.com/Via%20Roma%2012",
        "https://example.com/jobs/jane%2540example.com",
        "https://example.com/jobs/%252B39%2520324%2520986%25208002",
        "https://example.com/jobs/%252B39%252F324%252F986%252F8002",
        "https://example.com/jobs/Via%2520Roma%252012",
        "https://example.com/jobs/%0A",
        "https://user:password@example.com/jobs/123",
        "https://example..com/jobs/123",
        "https://example.com:99999/jobs/123",
    ],
)
def test_apply_url_rejects_non_http_contact_and_phone_urls(url):
    assert not is_safe_apply_url(url)


def test_apply_url_accepts_http_url_with_valid_host():
    assert is_safe_apply_url("https://example.com/jobs/123")
    assert is_safe_apply_url("https://example.com/jobs/1234567")
    assert is_safe_apply_url("https://www.linkedin.com/jobs/view/1234567890")
    assert is_safe_apply_url("http://localhost:8080/job")


def test_latest_accepts_linkedin_numeric_job_id_url():
    payload = valid_latest_payload()
    payload["results"][0]["url"] = "https://www.linkedin.com/jobs/view/1234567890"

    assert validate_latest_payload(payload) == []


def test_nullable_latest_result_fields_are_valid():
    payload = valid_latest_payload()
    result = payload["results"][0]
    result.update(
        company=None,
        location=None,
        url=None,
        description=None,
        remote=None,
        salary=None,
    )
    assert validate_latest_payload(payload) == []


def test_failure_shape_accepts_producer_fields_and_rejects_unsafe_variants():
    payload = valid_latest_payload()
    payload["failures"] = [
        {
            "call_id": "freehire-01",
            "portal": "freehire",
            "code": "NO_CREDENTIALS",
            "message": "source unavailable",
            "exit_code": 2,
            "raw_file": "job_scraper/runs/run/raw.json",
            "stderr_file": "job_scraper/runs/run/error.stderr",
            "backup_file": None,
            "expected": True,
        }
    ]
    assert validate_latest_payload(payload) == []

    for mutation in (
        {"extra": "reject"},
        {"exit_code": -1},
        {"expected": "true"},
        {"message": "Authorization: Bearer secret"},
        {"portal": "bad portal"},
    ):
        invalid = copy.deepcopy(payload)
        invalid["failures"][0].update(mutation)
        assert validate_latest_payload(invalid)


def reviewer_output():
    return {
        "job_key": "freehire:job-1",
        "score": 8.4,
        "tier": "B+",
        "verdict": "APLICAR",
        "strengths": [
            "Contact jane@example.com is listed",
            "Strong automation match",
            "Remote fit",
        ],
        "gaps": [
            "Call +39 324 986 8002 for details",
            "Salary unknown",
            "No local office",
        ],
        "salary": "Ask at Via Roma 12",
        "notes": "Contact jane@example.com before applying.",
    }


def test_reviewer_output_is_redacted_before_persistence():
    sanitized = sanitize_reviewer_output(reviewer_output())

    text = " ".join(
        sanitized["strengths"]
        + sanitized["gaps"]
        + [sanitized["salary"], sanitized["notes"]]
    )
    assert "jane@example.com" not in text
    assert "+39 324 986 8002" not in text
    assert "Via Roma 12" not in text
    assert "[EMAIL_REDACTED]" in text
    assert "[PHONE_REDACTED]" in text
    assert "[ADDRESS_REDACTED]" in text
    assert "[CONTACT_REDACTION_APPLIED]" in sanitized["notes"]
    assert not contains_contact_pattern(text)


def test_reviewer_output_rejects_unsafe_structure_and_veto_mismatch():
    invalid_extra = reviewer_output()
    invalid_extra["extra"] = "reject"
    with pytest.raises(ValueError):
        sanitize_reviewer_output(invalid_extra)

    invalid_id = reviewer_output()
    invalid_id["job_key"] = "freehire:bad@id"
    with pytest.raises(ValueError):
        sanitize_reviewer_output(invalid_id)

    wrong_candidate = reviewer_output()
    wrong_candidate["job_key"] = "freehire:other-job"
    with pytest.raises(ValueError):
        sanitize_reviewer_output(wrong_candidate, expected_job_key="freehire:job-1")

    invalid_veto = reviewer_output()
    invalid_veto.update(tier="VETO", verdict="APLICAR")
    with pytest.raises(ValueError):
        sanitize_reviewer_output(invalid_veto)


@pytest.mark.parametrize(
    "score", [8, 8.04, float("nan"), float("inf"), "8.4"]
)
def test_reviewer_output_rejects_non_contract_scores(score):
    invalid = reviewer_output()
    invalid["score"] = score

    with pytest.raises(ValueError):
        sanitize_reviewer_output(invalid)


def test_reviewer_output_rejects_huge_integer_without_float_overflow():
    invalid = reviewer_output()
    invalid["score"] = 10**1000

    with pytest.raises(ValueError):
        sanitize_reviewer_output(invalid)


def test_reviewer_output_rejects_blank_strengths_and_gaps():
    invalid = reviewer_output()
    invalid["strengths"][0] = " \t"

    with pytest.raises(ValueError):
        sanitize_reviewer_output(invalid)


def test_redact_contacts_uses_stable_tokens():
    text = "Email jane@example.com, phone (+39) 324 986 8002, address Via Roma, 12."
    redacted = redact_contacts(text)
    assert redacted == (
        "Email [EMAIL_REDACTED], phone [PHONE_REDACTED], "
        "address [ADDRESS_REDACTED]."
    )


@pytest.mark.parametrize(
    "text, token",
    [
        ("jane%40example%2Ecom", "[EMAIL_REDACTED]"),
        ("jane%2540example%252Ecom", "[EMAIL_REDACTED]"),
        ("Call %2B39%20324%20986%208002", "[PHONE_REDACTED]"),
        ("Call %252B39%2520324%2520986%25208002", "[PHONE_REDACTED]"),
        ("Call +39/324/986/8002", "[PHONE_REDACTED]"),
        ("Via%2520Roma%252012", "[ADDRESS_REDACTED]"),
    ],
)
def test_redact_contacts_handles_encoded_contact_variants(text, token):
    redacted = redact_contacts(text)

    assert token in redacted
    assert not any(raw in redacted for raw in ("jane", "+39", "Via Roma"))
    assert not contains_contact_pattern(redacted)
