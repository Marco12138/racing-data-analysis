"""Shared zh/en copy helpers for analysis-facing text generation.

This module only shapes wording; it never changes analysis logic or measured
values. English remains the default so existing callers are unaffected.
"""

from __future__ import annotations

import re
from typing import Any

Locale = str  # "zh" | "en"

NUMBER_PATTERN = re.compile(r"\d")

# Vague template words that make a teaching point useless without numbers.
FORBIDDEN_EN = ("overall", "generally", "try", "improve", "better")
FORBIDDEN_ZH = ("注意", "改善", "提高", "更好", "尝试", "优化")

# Corner/distance keywords that anchor a teaching point to evidence.
DISTANCE_KEYWORDS = ("m", "米", "弯", "corner", "zone", "sector", "km/h", "rpm")


def _is_specific(text: str, language: str = "en") -> bool:
    """A coach point must carry a number, a corner/distance anchor, and no vague filler."""
    if not NUMBER_PATTERN.search(text):
        return False
    lowered = text.lower()
    if not any(keyword in lowered for keyword in DISTANCE_KEYWORDS):
        return False
    banned = FORBIDDEN_ZH if language == "zh" else FORBIDDEN_EN
    if language == "zh":
        return not any(word in lowered for word in banned)
    return not re.search(
        r"\b(?:overall|generally|try|improve|better)\b",
        lowered,
    )


def is_specific_text(text: str, language: str = "en") -> bool:
    """Public alias of the specificity guard used by narrative layers."""
    return _is_specific(text, language)


def localize_pattern(pattern: str, language: str = "en") -> str:
    """Translate the known consensus pattern labels without touching values."""
    if language != "zh" or not pattern:
        return pattern
    match = re.match(
        r"^(Lift position|Sustained RPM recovery|Exit speed) repeats near "
        r"([0-9.]+) (m|km/h)$",
        pattern,
    )
    if match:
        kind, value, unit = match.groups()
        label = {
            "Lift position": "抬油门位置",
            "Sustained RPM recovery": "持续 RPM 恢复",
            "Exit speed": "出弯速度",
        }[kind]
        return f"{label}稳定在 {value} {unit} 附近"
    match = re.match(r"^Minimum RPM remains repeatable near ([0-9]+) rpm$", pattern)
    if match:
        return f"最低 RPM 稳定在 {match.group(1)} rpm 附近"
    return pattern


def localized_patterns(patterns: list[Any], language: str = "en") -> list[str]:
    """Localize a list of consensus pattern strings."""
    return [
        localize_pattern(str(pattern), language)
        for pattern in patterns
        if pattern
    ]
