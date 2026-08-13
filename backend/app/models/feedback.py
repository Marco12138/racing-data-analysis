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
