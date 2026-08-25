"""Public contract for AI-advice feedback records."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from .demo_session import DemoModel


class NarrativeFeedbackRequest(DemoModel):
    """One thumbs up/down on a coach or storyboard teaching point."""

    node_id: str = Field(min_length=1, max_length=200)
    token: str | None = Field(default=None, max_length=200)
    source: Literal["llm", "structured", "storyboard", "coach"]
    locale: Literal["zh", "en"]
    thumbs_up: bool


class CoachValidationRequest(DemoModel):
    """Coach review of one evidence-bounded braking pattern."""

    inspection_id: str = Field(min_length=32, max_length=32, pattern=r"^[0-9a-f]+$")
    episode_id: str = Field(min_length=1, max_length=200)
    pattern_id: str = Field(min_length=1, max_length=240)
    pattern_type: Literal[
        "BRAKE_LATE_REINFORCEMENT",
        "BRAKE_RELEASE_ABRUPT",
        "BRAKE_STEERING_OVERLAP",
    ]
    verdict: Literal["confirmed", "rejected", "uncertain"]
    locale: Literal["zh", "en"]
    notes: str | None = Field(default=None, max_length=500)
