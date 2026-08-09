"""Stable public contract for the reviewed real-session Demo."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict


class DemoModel(BaseModel):
    """Reject accidental additions to the public Demo contract."""

    model_config = ConfigDict(extra="forbid")


class DemoProvenance(DemoModel):
    """Publication and measurement provenance for the reviewed artifact."""

    dataset_kind: Literal["anonymized_real_session"]
    derived_from_real_session: Literal[True]
    publication_permission: Literal["confirmed"]
    telemetry_values: Literal["measured_or_backend_calculated_only"]
    privacy_review_status: Literal["passed"]
    private_identifiers_removed: Literal[True]


class DemoDisplay(DemoModel):
    """Anonymous labels safe to render on the public page."""

    driver: str
    vehicle: str
    track: str
    date: str


class DemoFastestLap(DemoModel):
    """Fastest real completed lap in the reviewed session."""

    lap: int
    lap_time: float


class DemoLapRow(DemoModel):
    """One real logger lap exposed by the compact Demo."""

    lap: int
    lap_time: float
    notes: str | None = None


class DemoTrackPoint(DemoModel):
    """One local-coordinate thumbnail point without absolute GPS position."""

    distance_m: float
    local_x_m: float
    local_y_m: float


class DemoTrack(DemoModel):
    """Compact local-coordinate track outline."""

    lap_length_m: float
    points: list[DemoTrackPoint]


class DemoSectorLossLap(DemoModel):
    """Per-lap losses against the real session's sector minima."""

    lap: int
    total_loss_s: float
    sector_losses: dict[str, float]


class DemoSectorLoss(DemoModel):
    """Virtual or official sector-loss provenance and values."""

    source: str
    official: bool
    sector_best: dict[str, float]
    laps: list[DemoSectorLossLap]


class DemoSummary(DemoModel):
    """LLM narrative when reviewed, otherwise the structured report."""

    source: Literal["llm", "structured"]
    narrative: str
    bullets: list[str]


class DemoSessionResponse(DemoModel):
    """Versioned response for the public reviewed XRK Demo session."""

    schema_version: int
    provenance: DemoProvenance
    display: DemoDisplay
    fastest_lap: DemoFastestLap
    lap_rows: list[DemoLapRow]
    track: DemoTrack
    sector_loss: DemoSectorLoss
    summary: DemoSummary
    synthetic_curve_generated: Literal[False]
