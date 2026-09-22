"""Portable, user-owned track geometry; never a synthetic performance reference."""

from typing import Literal

import numpy as np
from pydantic import BaseModel, ConfigDict, Field, model_validator


class TrackModel(BaseModel):
    """Reject unbounded or non-finite geometry from anonymous clients."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class SpatialGate(TrackModel):
    """Finite directed line segment in the reference map's local metre frame."""

    a: tuple[float, float]
    b: tuple[float, float]
    forward: tuple[float, float]
    confirmed: bool = False

    @model_validator(mode="after")
    def validate_geometry(self):
        """Require a usable cross-track line and approximately unit forward normal."""
        width = np.subtract(self.b, self.a)
        norm = np.linalg.norm(width)
        if not 2 <= norm <= 60 or not .99 <= np.linalg.norm(self.forward) <= 1.01:
            raise ValueError("Gate width must be 2-60m and forward must be a unit vector.")
        if abs(np.dot(width / norm, self.forward)) > .05:
            raise ValueError("Gate forward must be perpendicular to the gate.")
        if np.max(np.abs([self.a, self.b])) > 20000:
            raise ValueError("Gate coordinates are outside the local map.")
        return self


class TrackCorner(TrackModel):
    """One spatial analysis interval, with a user-confirmed name only when reviewed."""

    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,40}$")
    name: str = Field(min_length=1, max_length=80)
    entry_gate: SpatialGate
    exit_gate: SpatialGate
    confirmed: bool = False


class TrackAcceptance(TrackModel):
    """Exploratory thresholds, not sensor specifications or validated probabilities."""

    median_residual_m: float = Field(default=1, gt=0, le=5)
    p95_residual_m: float = Field(default=2.5, gt=0, le=10)
    max_translation_m: float = Field(default=20, gt=0, le=30)
    max_fold_shift_difference_m: float = Field(default=3, gt=0, le=5)
    max_length_difference_ratio: float = Field(default=.03, gt=0, le=.1)
    max_time_gap_s: float = Field(default=.5, gt=0, le=1)


class TrackReference(TrackModel):
    """Versioned geometry from one real lap; edits create a new revision."""

    schema_version: Literal[1] = 1
    track_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,80}$")
    revision: int = Field(default=1, ge=1, le=100000)
    venue_aliases: list[str] = Field(default_factory=list, max_length=20)
    direction: Literal["CW", "CCW"]
    origin_lat: float = Field(ge=-85, le=85)
    origin_lon: float = Field(ge=-180, le=180)
    source_fingerprint: str = Field(pattern=r"^[0-9a-f]{64}$")
    source_lap: int = Field(ge=1)
    reference_path: list[tuple[float, float]] = Field(min_length=100, max_length=5000)
    start_finish_gate: SpatialGate
    corners: list[TrackCorner] = Field(default_factory=list, max_length=30)
    acceptance: TrackAcceptance = Field(default_factory=TrackAcceptance)
    source: Literal["real_observed_lap"] = "real_observed_lap"
    official: Literal[False] = False

    @model_validator(mode="after")
    def validate_path(self):
        """Avoid malformed reference maps and duplicate corner identifiers."""
        points = np.asarray(self.reference_path)
        steps = np.linalg.norm(np.diff(points, axis=0), axis=1)
        if np.max(np.abs(points)) > 20000 or not 100 <= steps.sum() <= 15000:
            raise ValueError("Reference geometry is outside supported map bounds.")
        if np.any(steps <= 0) or np.max(steps) > 20 or np.linalg.norm(points[-1] - points[0]) > 15:
            raise ValueError("Reference path must be continuous and nearly closed.")
        if len({c.id for c in self.corners}) != len(self.corners):
            raise ValueError("Corner identifiers must be unique.")
        following = np.roll(points, -1, axis=0)
        winding = "CCW" if np.sum(points[:, 0] * following[:, 1] - following[:, 0] * points[:, 1]) > 0 else "CW"
        if winding != self.direction:
            raise ValueError("Track direction does not match the reference path.")
        indexes = []
        for gate in [self.start_finish_gate, *[g for c in self.corners for g in (c.entry_gate, c.exit_gate)]]:
            center = (np.array(gate.a) + gate.b) / 2
            if np.min(np.linalg.norm(points - center, axis=1)) > 20:
                raise ValueError("A gate does not intersect the reference map vicinity.")
            index = int(np.argmin(np.linalg.norm(points - center, axis=1)))
            tangent = points[(index + 4) % len(points)] - points[(index - 4) % len(points)]
            if np.dot(tangent, gate.forward) <= 0:
                raise ValueError("A gate faces against the reference driving direction.")
            indexes.append(index)
        ordered = [(i - indexes[0]) % len(points) for i in indexes[1:]]
        if ordered and (ordered[0] == 0 or np.any(np.diff(ordered) <= 0)):
            raise ValueError("Corner gates must be ordered, non-overlapping and must not span the timing line. Merge or move the candidate gates first.")
        return self
