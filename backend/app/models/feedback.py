"""Public contract for AI-advice feedback records."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, model_validator

from .demo_session import DemoModel


class FeedbackContext(DemoModel):
    """Client context is a hint; the server verifies real inspection provenance."""

    data_origin: Literal["real", "demo", "unknown"] = "unknown"


class NarrativeFeedbackRequest(FeedbackContext):
    """One thumbs up/down on a coach or storyboard teaching point."""

    node_id: str = Field(min_length=1, max_length=200)
    token: str | None = Field(default=None, max_length=200)
    source: Literal["llm", "structured", "storyboard", "coach"]
    locale: Literal["zh", "en"]
    thumbs_up: bool


class CoachValidationRequest(FeedbackContext):
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


class ClipCorrection(DemoModel):
    """User-supplied crop/anchor provenance, not a verified driving label."""

    original_clip_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    original_start_s: float | None = Field(default=None, ge=0, le=86400, allow_inf_nan=False)
    original_end_s: float | None = Field(default=None, gt=0, le=86400, allow_inf_nan=False)
    anchor_video_s: float | None = Field(default=None, ge=0, le=86400, allow_inf_nan=False)
    anchor_session_s: float | None = Field(default=None, ge=0, le=86400, allow_inf_nan=False)
    anchor_distance_m: float | None = Field(default=None, ge=0, le=100000, allow_inf_nan=False)

    @model_validator(mode="after")
    def validate_pairs(self) -> "ClipCorrection":
        """A partial original window or anchor must not imply synchronization."""
        if self.original_clip_id is None:
            if self.original_start_s is not None or self.original_end_s is not None:
                raise ValueError("Original timing requires the original clip identity.")
        elif self.original_start_s is None or self.original_end_s is None or not 0 < self.original_end_s - self.original_start_s <= 120:
            raise ValueError("Original clip timing is incomplete.")
        anchors = (self.anchor_video_s, self.anchor_session_s, self.anchor_distance_m)
        if any(v is not None for v in anchors) and not all(v is not None for v in anchors):
            raise ValueError("The synchronization anchor is incomplete.")
        return self


class ClipFeedbackRequest(FeedbackContext):
    """Selection accuracy, separate from advice quality or a confirmed driving action."""

    feedback_id: str = Field(pattern=r"^[0-9a-f]{32}$")
    inspection_id: str | None = Field(default=None, pattern=r"^[0-9a-f]{32}$")
    clip_id: str = Field(pattern=r"^[0-9a-f]{64}$")
    session_fingerprint: str = Field(min_length=8, max_length=128)
    zone_id: str = Field(min_length=1, max_length=100)
    reference_lap: int = Field(ge=0, le=100000)
    target_lap: int = Field(ge=0, le=100000)
    start_s: float = Field(ge=0, le=86400, allow_inf_nan=False)
    end_s: float = Field(gt=0, le=86400, allow_inf_nan=False)
    verdict: Literal["accurate", "partly_accurate", "inaccurate", "uncertain"]
    reason: Literal["too_early", "too_late", "wrong_corner", "too_short", "not_relevant", "sync_uncertain"] | None = None
    locale: Literal["zh", "en"]
    selection_version: Literal["coach-review-v1"] = "coach-review-v1"
    selection_source: Literal["automatic", "manual"] = "automatic"
    side: Literal["reference", "target"] = "target"
    sync_confirmed: bool | None = None
    correction: ClipCorrection | None = None

    @model_validator(mode="after")
    def validate_window(self) -> "ClipFeedbackRequest":
        """Reject invalid windows and contradictory feedback choices."""
        if not 0 < self.end_s - self.start_s <= 120:
            raise ValueError("The clip window must be between 0 and 120 seconds.")
        if self.verdict == "accurate" and self.reason is not None:
            raise ValueError("An accurate clip must not include a correction reason.")
        if self.selection_source == "automatic" and self.correction is not None:
            raise ValueError("Automatic selection feedback cannot contain a manual correction.")
        if self.selection_source == "manual":
            if self.correction is None or self.sync_confirmed is None:
                raise ValueError("Manual feedback requires correction provenance.")
            if self.sync_confirmed and self.correction.anchor_session_s is None:
                raise ValueError("Confirmed synchronization requires a complete anchor.")
            if not self.sync_confirmed and self.verdict != "uncertain":
                raise ValueError("Unsynchronized clips cannot confirm a telemetry correspondence.")
        return self
