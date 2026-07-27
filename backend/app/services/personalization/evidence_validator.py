from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from typing import Iterable


@dataclass(frozen=True)
class EvidenceValidationResult:
    valid: bool
    normalized_quote: str
    rejection_reason: str | None = None


def normalize_evidence_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value or "")
    normalized = normalized.replace("​", "")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def validate_evidence_quote(
    evidence_quote: str,
    allowed_user_texts: Iterable[str],
) -> EvidenceValidationResult:
    quote = normalize_evidence_text(evidence_quote)

    if len(quote) < 2:
        return EvidenceValidationResult(
            valid=False,
            normalized_quote=quote,
            rejection_reason="evidence_quote_too_short",
        )

    normalized_sources = [
        normalize_evidence_text(text)
        for text in allowed_user_texts
        if normalize_evidence_text(text)
    ]

    if not normalized_sources:
        return EvidenceValidationResult(
            valid=False,
            normalized_quote=quote,
            rejection_reason="no_allowed_user_text",
        )

    if any(quote in source for source in normalized_sources):
        return EvidenceValidationResult(
            valid=True,
            normalized_quote=quote,
        )

    return EvidenceValidationResult(
        valid=False,
        normalized_quote=quote,
        rejection_reason="evidence_quote_not_found_in_user_text",
    )
