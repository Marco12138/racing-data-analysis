"""Stable public contract for shareable AI driving review storyboards."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .demo_session import DemoModel


class StoryboardAlignmentRequest(DemoModel):
    """Video-telemetry alignment anchor supplied by the browser workspace."""

    offset_ms: int
    video_duration_s: float = Field(gt=0, le=86_400)
    target_lap: int | None = Field(default=None, ge=1)
    telemetry_session_time_s: float | None = None
    video_time_s: float | None = None
    video_size_bytes: int | None = Field(default=None, ge=0)
    video_last_modified_ms: int | None = Field(default=None, ge=0)
    video_mime_type: str | None = Field(default=None, max_length=120)


class StoryboardOverlay(DemoModel):
    """Measured or calculated overlay curves; missing channels stay empty."""

    distance_m: list[float]
    session_time_s: list[float]
    speed_kmh: list[float]
    rpm: list[float]
    longitudinal_g: list[float]
    lateral_g: list[float]
    throttle: list[float | None]
    brake: list[float | None]
    available: dict[str, bool]


class StoryboardCorner(DemoModel):
    """Real corner reference used by one teaching node."""

    name: str
    entry_distance_m: float
    exit_distance_m: float


class StoryboardNode(DemoModel):
    """One 60-90s teaching moment with mandatory video evidence."""

    id: str
    kind: Literal["corner", "event"]
    title: str
    time_range: list[float] = Field(min_length=2, max_length=2)
    distance_range_m: list[float] = Field(min_length=2, max_length=2)
    telemetry_overlay: StoryboardOverlay
    insight: str
    drill: str
    evidence_laps: list[int]
    corner: StoryboardCorner | None = None
    source: Literal["structured", "llm"] = "structured"


class StoryboardVideoInfo(DemoModel):
    """Video evidence boundary: clips are bounded but the file stays local."""

    duration_s: float
    required: bool
    uploaded: bool


class StoryboardAnalysisSummary(DemoModel):
    """Real-lap provenance shown on the share page."""

    reference_lap: int | None = None
    target_lap: int | None = None
    fastest_lap: dict | None = None


class StoryboardResponse(BaseModel):
    """Versioned read-only storyboard payload returned to the creator and share page."""

    model_config = ConfigDict(extra="forbid")

    schema_version: int
    token: str
    watermark: str
    created_at: str
    expires_at: str
    analysis: StoryboardAnalysisSummary
    video: StoryboardVideoInfo
    nodes: list[StoryboardNode]
