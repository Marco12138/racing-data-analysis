"""Stable public error envelopes for XRK API requests."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PublicApiError(Exception):
    """An expected API failure that is safe to show to end users."""

    status_code: int
    error_code: str
    message: str
    error_type: str = "request_error"

    def __str__(self) -> str:
        return self.message
