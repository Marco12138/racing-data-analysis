"""Request models for local video analysis."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class VideoJobCreate(BaseModel):
    """Request a background analysis for a local video source."""

    source_id: str = Field(min_length=8, max_length=64)


class VideoMarkerCreate(BaseModel):
    """Create a manual video timeline marker."""

    marker_type: Literal["lap_start", "lap_end", "corner", "event"]
    timestamp: float = Field(ge=0)
    lap: int | None = Field(default=None, ge=1)
    notes: str = Field(default="", max_length=500)
