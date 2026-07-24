"""Tests for ATS-hostile URL detection and contact email extraction."""

import pytest

from tools.rank_safety import detect_ats_hostil, extract_contact_email


class TestDetectAtsHostil:
    @pytest.mark.parametrize("url", [
        "https://company.workday.com/en-US/job/12345",
        "https://wd1.myworkdaysite.com/en-US/external/job/ABC",
        "https://jobs.taleo.net/careersection/acme/jobdetail.ftl?job=123",
        "https://careers.successfactors.com/acme/job/123",
        "https://careers.icims.com/jobs/1234/it-manager/job",
        "https://jobs.phenompeople.com/acme/job/123",
        "https://jobs.smartrecruiters.com/Acme/123-it-manager",
        "https://acme.jobvite.com/job/123",
    ])
    def test_hostile_ats_returns_true(self, url):
        assert detect_ats_hostil(url) is True

    @pytest.mark.parametrize("url", [
        "https://www.linkedin.com/jobs/view/123456",
        "https://jobs.lever.co/acme/abc-123",
        "https://boards.greenhouse.io/acme/jobs/123",
        "https://acme.com/careers/it-manager",
        "https://es.indeed.com/job/123",
        "https://oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123",
        "https://sap.com/careers/job/123",
        None,
        "",
        "not-a-url",
    ])
    def test_safe_or_invalid_returns_false(self, url):
        assert detect_ats_hostil(url) is False


class TestExtractContactEmail:
    def test_simple_email(self):
        text = "Send your CV to hr@acme.com for more info."
        assert extract_contact_email(text) == "hr@acme.com"

    def test_multiple_emails_returns_first(self):
        text = "Contact hiring@acme.com or jobs@acme.com."
        assert extract_contact_email(text) == "hiring@acme.com"

    def test_italian_apply_pattern(self):
        text = "Invia il tuo CV a selezione@azienda.it indicando il riferimento."
        assert extract_contact_email(text) == "selezione@azienda.it"

    def test_no_email_returns_none(self):
        assert extract_contact_email("Apply on our website.") is None
        assert extract_contact_email("") is None
        assert extract_contact_email(None) is None

    def test_noreply_filtered(self):
        text = "Do not reply to noreply@acme.com. Apply via website."
        assert extract_contact_email(text) is None

    def test_no_reply_variant_filtered(self):
        text = "Automatic message from no-reply@acme.com."
        assert extract_contact_email(text) is None
