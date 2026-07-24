#!/usr/bin/env python3
"""Pure-stdlib safety rules shared by the /job-rank command and its tests."""

import html
import ipaddress
import math
import re
from datetime import datetime
from typing import Any, Dict, List, Optional
from urllib.parse import unquote, urlsplit, urlunsplit


_IDENTIFIER_RE = re.compile(r"^[A-Za-z0-9._:-]+$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_EMAIL_RE = re.compile(
    r"(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"
)
_PHONE_RE = re.compile(r"(?<![\w])(?:\(?\+?\d[\d\s()./-]{5,}\d)(?![\w])")
_STREET_PREFIX_RE = re.compile(
    r"(?i)\b(?:via|viale|piazza|corso|calle|carrer|street|st\.?|road|rd\.?|"
    r"avenue|ave\.?|boulevard|blvd\.?)\s+"
    r"[A-Za-zÀ-ÿ0-9.'’-]+(?:\s+[A-Za-zÀ-ÿ0-9.'’-]+){0,5},?\s+\d+[A-Za-z]?\b"
)
_STREET_SUFFIX_RE = re.compile(
    r"(?i)\b\d{1,5}\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'’-]*(?:\s+"
    r"[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ.'’-]*){0,4}\s+"
    r"(?:street|st\.?|road|rd\.?|avenue|ave\.?|boulevard|blvd\.?)\b"
)
_STREET_NUMBER_PREFIX_RE = re.compile(
    r"(?i)\b\d{1,5}[A-Za-z]?\s+"
    r"(?:via|viale|piazza|corso|calle|carrer|street|st\.?|road|rd\.?|"
    r"avenue|ave\.?|boulevard|blvd\.?)\b"
)
_SECRET_RE = re.compile(
    r"(?i)(?:authorization|\bbasic\s+[A-Za-z0-9+/=]{8,}|"
    r"(?:api[_ -]?key|app[_ -]?(?:id|key)|client[_ -]?(?:id|secret)|"
    r"access[_ -]?token|password|secret)\s*[:=])"
)
_SAFE_HOST_LABEL_RE = re.compile(
    r"^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$"
)
_JOB_ID_PATH_RE = re.compile(r"(?:(?<=/)|(?<=-)|(?<=_))[0-9]{7,12}(?=$|/)")

_REVIEWER_KEYS = {
    "job_key",
    "score",
    "tier",
    "verdict",
    "strengths",
    "gaps",
    "salary",
    "notes",
}
_RESULT_KEYS = {
    "id",
    "portal",
    "title",
    "company",
    "location",
    "url",
    "date",
    "description",
    "remote",
    "salary",
    "source_call",
    "new",
    "source_ids",
    "duplicate_sources",
    "job_key",
    "email_contacto",
    "ats_hostil",
}
_RESULT_REQUIRED_KEYS = _RESULT_KEYS - {"job_key"}
_FAILURE_KEYS = {
    "call_id",
    "portal",
    "code",
    "message",
    "exit_code",
    "raw_file",
    "stderr_file",
    "backup_file",
    "expected",
}
_COUNT_KEYS = {
    "calls",
    "successful_calls",
    "failed_calls",
    "skipped_calls",
    "raw_results",
    "normalized_results",
    "deduplicated",
    "new",
    "seen",
    "failures",
    "skipped",
}
_CONTACT_DECODE_ROUNDS = 8


def normalize_strict_date(value: Any) -> Optional[str]:
    """Return a real calendar date as YYYY-MM-DD, or None."""
    if not isinstance(value, str) or not value:
        return None
    if any(char.isspace() or ord(char) < 32 for char in value):
        return None

    if _DATE_RE.fullmatch(value):
        try:
            return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
        except ValueError:
            return None

    if len(value) < 11 or value[10] != "T":
        return None
    timestamp = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(timestamp)
    except ValueError:
        return None
    return parsed.date().isoformat()


def _phone_replacement(match: re.Match) -> str:
    candidate = match.group(0)
    if _DATE_RE.fullmatch(candidate):
        return candidate
    return "[PHONE_REDACTED]" if sum(char.isdigit() for char in candidate) >= 7 else candidate


def _redact_plain_contacts(text: str) -> str:
    redacted = _EMAIL_RE.sub("[EMAIL_REDACTED]", text)
    redacted = _PHONE_RE.sub(_phone_replacement, redacted)
    redacted = _STREET_PREFIX_RE.sub("[ADDRESS_REDACTED]", redacted)
    redacted = _STREET_SUFFIX_RE.sub("[ADDRESS_REDACTED]", redacted)
    return _STREET_NUMBER_PREFIX_RE.sub("[ADDRESS_REDACTED]", redacted)


def _contact_variants(text: str) -> List[str]:
    """Return bounded percent/HTML-decoded variants for contact detection."""
    variants = [text]
    current = text
    for _ in range(_CONTACT_DECODE_ROUNDS):
        decoded = html.unescape(unquote(current))
        if decoded == current or decoded in variants:
            break
        variants.append(decoded)
        current = decoded
    return variants


def _contains_plain_contact_pattern(value: str) -> bool:
    if _EMAIL_RE.search(value) or _STREET_PREFIX_RE.search(value):
        return True
    if _STREET_SUFFIX_RE.search(value) or _STREET_NUMBER_PREFIX_RE.search(value):
        return True
    return any(
        _phone_replacement(match) == "[PHONE_REDACTED]"
        for match in _PHONE_RE.finditer(value)
    )


def redact_contacts(text: Any) -> Any:
    """Redact contact-like text using stable, deterministic tokens."""
    if not isinstance(text, str):
        return text
    for variant in reversed(_contact_variants(text)):
        if _contains_plain_contact_pattern(variant):
            return _redact_plain_contacts(variant)
    return text


def is_safe_identifier(value: Any) -> bool:
    """Return whether value is a non-empty ASCII identifier safe to persist."""
    return (
        isinstance(value, str)
        and bool(_IDENTIFIER_RE.fullmatch(value))
        and any(char.isascii() and char.isalnum() for char in value)
    )


def _contains_contact_pattern(value: str) -> bool:
    return any(
        _contains_plain_contact_pattern(variant)
        for variant in _contact_variants(value)
    )


def contains_contact_pattern(value: Any) -> bool:
    """Return whether a string still contains a detectable contact pattern."""
    return isinstance(value, str) and _contains_contact_pattern(value)


def _valid_host(host: Optional[str]) -> bool:
    if not host or len(host) > 253:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass

    try:
        ascii_host = host.encode("idna").decode("ascii")
    except UnicodeError:
        return False
    if len(ascii_host) > 253 or ascii_host.endswith(".."):
        return False
    if ascii_host.endswith("."):
        ascii_host = ascii_host[:-1]
    labels = ascii_host.split(".")
    return bool(labels) and all(_SAFE_HOST_LABEL_RE.fullmatch(label) for label in labels)


def _mask_job_id_path_sequences(value: str) -> str:
    try:
        parts = urlsplit(value)
    except ValueError:
        return value
    path = _JOB_ID_PATH_RE.sub("[JOB_ID]", parts.path)
    return urlunsplit((parts.scheme, parts.netloc, path, parts.query, parts.fragment))


def _contains_formatted_phone_path(value: str) -> bool:
    try:
        path = urlsplit(value).path
    except ValueError:
        return False
    for match in _PHONE_RE.finditer(path):
        job_id_match = _JOB_ID_PATH_RE.search(path, match.start())
        if job_id_match is not None and job_id_match.span() == match.span():
            continue
        return True
    return False


def is_safe_apply_url(value: Any) -> bool:
    """Accept only contact-free HTTP(S) URLs with a valid host."""
    if not isinstance(value, str) or not value or any(
        ord(char) < 32 or ord(char) == 127 or char.isspace() for char in value
    ):
        return False
    try:
        parts = urlsplit(value)
        if parts.scheme.lower() not in {"http", "https"} or not parts.netloc:
            return False
        if parts.username is not None or parts.password is not None:
            return False
        if not _valid_host(parts.hostname):
            return False
        _ = parts.port
    except ValueError:
        return False
    variants = _contact_variants(value)
    if any(
        ord(char) < 32 or ord(char) == 127
        for variant in variants
        for char in variant
    ):
        return False
    return not any(
        _contains_formatted_phone_path(variant)
        or _contains_plain_contact_pattern(_mask_job_id_path_sequences(variant))
        for variant in variants
    )


def _non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _non_negative_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def _nullable_string(value: Any) -> bool:
    return value is None or isinstance(value, str)


def _safe_failure_text(value: Any) -> bool:
    return _non_empty_string(value) and not _SECRET_RE.search(value)


def _validate_failure(failure: Any, index: int) -> List[str]:
    errors: List[str] = []
    prefix = "failures[{}]".format(index)
    if not isinstance(failure, dict):
        return ["{}: must be an object".format(prefix)]
    unexpected = set(failure) - _FAILURE_KEYS
    if unexpected:
        errors.append("{}: unexpected fields".format(prefix))

    for field in ("call_id", "portal", "code"):
        if not is_safe_identifier(failure.get(field)):
            errors.append("{}.{}: unsafe identifier".format(prefix, field))
    if not _safe_failure_text(failure.get("message")):
        errors.append("{}.message: unsafe string".format(prefix))
    if "exit_code" in failure and not _non_negative_integer(failure["exit_code"]):
        errors.append("{}.exit_code: invalid integer".format(prefix))
    for field in ("raw_file", "stderr_file", "backup_file"):
        if field in failure and not _nullable_string(failure[field]):
            errors.append("{}.{}: invalid path".format(prefix, field))
        if isinstance(failure.get(field), str) and _SECRET_RE.search(failure[field]):
            errors.append("{}.{}: secret content".format(prefix, field))
    if "expected" in failure and not isinstance(failure["expected"], bool):
        errors.append("{}.expected: invalid boolean".format(prefix))
    return errors


def validate_latest_payload(payload: Any) -> List[str]:
    """Return safe schema errors for a normalized /job-scrape latest payload."""
    errors: List[str] = []
    if not isinstance(payload, dict):
        return ["root: must be an object"]

    required = {"run_id", "generated_at", "results", "failures", "counts"}
    missing = required - set(payload)
    if missing:
        errors.append("root: missing required fields")
    if not is_safe_identifier(payload.get("run_id")):
        errors.append("run_id: unsafe identifier")
    generated_at = payload.get("generated_at")
    if (
        not isinstance(generated_at, str)
        or "T" not in generated_at
        or normalize_strict_date(generated_at) is None
    ):
        errors.append("generated_at: invalid ISO string")

    results = payload.get("results")
    if not isinstance(results, list):
        errors.append("results: must be an array")
    counts = payload.get("counts")
    if not isinstance(counts, dict):
        errors.append("counts: must be an object")
    else:
        if set(counts) - (_COUNT_KEYS | {"results"}):
            errors.append("counts: unexpected fields")
        if not _non_negative_integer(counts.get("results")):
            errors.append("counts.results: required non-negative integer")
        elif any(
            not _non_negative_integer(counts[name])
            for name in _COUNT_KEYS
            if name in counts
        ):
            errors.append("counts: invalid non-negative integer")

    failures = payload.get("failures")
    if not isinstance(failures, list):
        errors.append("failures: must be an array")
    else:
        for index, failure in enumerate(failures):
            errors.extend(_validate_failure(failure, index))

    seen_job_keys = set()
    if isinstance(results, list):
        for index, result in enumerate(results):
            errors.extend(_validate_result(result, index))
            if not isinstance(result, dict):
                continue
            portal = result.get("portal")
            result_id = result.get("id")
            if not is_safe_identifier(portal) or not is_safe_identifier(result_id):
                continue
            job_key = "{}:{}".format(portal, result_id)
            if job_key in seen_job_keys:
                errors.append("results[{}].job_key: duplicate job key".format(index))
            else:
                seen_job_keys.add(job_key)
    return errors


def _validate_result(result: Any, index: int) -> List[str]:
    errors: List[str] = []
    prefix = "results[{}]".format(index)
    if not isinstance(result, dict):
        return ["{}: must be an object".format(prefix)]
    missing = _RESULT_REQUIRED_KEYS - set(result)
    if missing:
        errors.append("{}: missing required fields".format(prefix))
    if set(result) - _RESULT_KEYS:
        errors.append("{}: unexpected fields".format(prefix))

    for field in ("id", "portal"):
        if not is_safe_identifier(result.get(field)):
            errors.append("{}.{}: unsafe identifier".format(prefix, field))
    if not _non_empty_string(result.get("title")):
        errors.append("{}.title: invalid string".format(prefix))
    for field in ("company", "location", "description", "salary"):
        if not _nullable_string(result.get(field)):
            errors.append("{}.{}: invalid nullable string".format(prefix, field))
    if result.get("url") is not None and not is_safe_apply_url(result.get("url")):
        errors.append("{}.url: unsafe apply URL".format(prefix))
    date_value = result.get("date")
    if date_value is not None or "date" not in result:
        if not isinstance(date_value, str) or normalize_strict_date(date_value) != date_value:
            errors.append("{}.date: invalid strict date".format(prefix))
    if result.get("remote") is not None and not isinstance(result.get("remote"), bool):
        errors.append("{}.remote: invalid boolean".format(prefix))
    if not isinstance(result.get("new"), bool):
        errors.append("{}.new: invalid boolean".format(prefix))
    if result.get("email_contacto") is not None and not _non_empty_string(result.get("email_contacto")):
        errors.append("{}.email_contacto: invalid nullable string".format(prefix))
    if result.get("ats_hostil") is not None and not isinstance(result.get("ats_hostil"), bool):
        errors.append("{}.ats_hostil: invalid boolean".format(prefix))
    if not is_safe_identifier(result.get("source_call")):
        errors.append("{}.source_call: unsafe identifier".format(prefix))

    for field in ("source_ids", "duplicate_sources"):
        values = result.get(field)
        if not isinstance(values, list) or not values or not all(
            is_safe_identifier(value) for value in values
        ):
            errors.append("{}.{}: unsafe identifier array".format(prefix, field))

    job_key = "{}:{}".format(result.get("portal"), result.get("id"))
    if not is_safe_identifier(job_key):
        errors.append("{}.job_key: unsafe identifier".format(prefix))
    if "job_key" in result and (
        not is_safe_identifier(result["job_key"]) or result["job_key"] != job_key
    ):
        errors.append("{}.job_key: does not match portal:id".format(prefix))
    return errors


def sanitize_reviewer_output(
    payload: Any, expected_job_key: Optional[str] = None
) -> Dict[str, Any]:
    """Validate and contact-redact one reviewer JSON object."""
    if not isinstance(payload, dict) or set(payload) != _REVIEWER_KEYS:
        raise ValueError("reviewer output has invalid fields")
    if not is_safe_identifier(payload.get("job_key")):
        raise ValueError("reviewer job_key is unsafe")
    if expected_job_key is not None:
        if not is_safe_identifier(expected_job_key):
            raise ValueError("expected reviewer job_key is unsafe")
        if payload["job_key"] != expected_job_key:
            raise ValueError("reviewer job_key does not match candidate")
    score = payload.get("score")
    if not isinstance(score, float):
        raise ValueError("reviewer score is not numeric")
    if not math.isfinite(score) or not 0 <= score <= 10 or round(score, 1) != score:
        raise ValueError("reviewer score is out of range")
    if payload.get("tier") not in {"A+", "A", "B+", "B", "C", "VETO"}:
        raise ValueError("reviewer tier is invalid")
    if payload.get("verdict") not in {"APLICAR", "APLICAR SI SOBRA TIEMPO", "DESCARTAR"}:
        raise ValueError("reviewer verdict is invalid")
    if payload.get("tier") == "VETO" and payload.get("verdict") != "DESCARTAR":
        raise ValueError("reviewer veto verdict is invalid")
    for field in ("strengths", "gaps"):
        values = payload.get(field)
        if not isinstance(values, list) or len(values) != 3 or not all(
            isinstance(value, str) and bool(value.strip()) for value in values
        ):
            raise ValueError("reviewer {} is invalid".format(field))
    if not isinstance(payload.get("salary"), str) or not isinstance(payload.get("notes"), str):
        raise ValueError("reviewer free text is invalid")

    sanitized: Dict[str, Any] = dict(payload)
    changed = False
    for field in ("strengths", "gaps"):
        redacted = [redact_contacts(value) for value in sanitized[field]]
        changed = changed or redacted != sanitized[field]
        sanitized[field] = redacted
    for field in ("salary", "notes"):
        redacted = redact_contacts(sanitized[field])
        changed = changed or redacted != sanitized[field]
        sanitized[field] = redacted
    if changed:
        sanitized["notes"] += " [CONTACT_REDACTION_APPLIED] no raw contact data is persisted."
    for field in ("strengths", "gaps", "salary", "notes"):
        values = sanitized[field] if isinstance(sanitized[field], list) else [sanitized[field]]
        if any(contains_contact_pattern(value) for value in values):
            raise ValueError("reviewer contact pattern remains")
    return sanitized


_ATS_HOSTIL_DOMAINS = frozenset({
    "workday.com",
    "myworkdayjobs.com",
    "myworkdaysite.com",
    "taleo.net",
    "successfactors.com",
    "icims.com",
    "phenompeople.com",
    "smartrecruiters.com",
    "jobvite.com",
})

_NOREPLY_LOCAL_PARTS = frozenset({
    "noreply",
    "no-reply",
    "no_reply",
    "donotreply",
    "do-not-reply",
    "do_not_reply",
    "mailer-daemon",
    "postmaster",
})


def detect_ats_hostil(value: Any) -> bool:
    """Return whether the apply URL belongs to a hostile ATS (forced account or long form)."""
    if not isinstance(value, str) or not value:
        return False
    try:
        parts = urlsplit(value.lower())
    except ValueError:
        return False
    host = parts.hostname or ""
    if not host:
        return False
    return any(
        host == domain or host.endswith("." + domain)
        for domain in _ATS_HOSTIL_DOMAINS
    )


def extract_contact_email(description: Any) -> Optional[str]:
    """Return the first non-noreply email in a job description, or None."""
    if not isinstance(description, str) or not description:
        return None
    for match in _EMAIL_RE.finditer(description):
        email = match.group(0)
        local = email.split("@", 1)[0].lower()
        if local in _NOREPLY_LOCAL_PARTS:
            continue
        return email
    return None
