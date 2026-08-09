"""Build and load the compact, reviewed real-session Demo resource."""

from __future__ import annotations

import json
from importlib.resources import files
from typing import Any

from ..models.demo_session import DemoSessionResponse

TRACK_THUMBNAIL_MAX_POINTS = 96
RESOURCE_NAME = "demo_session.json"


def build_demo_session_payload(reviewed: dict[str, Any]) -> dict[str, Any]:
    """Select only reviewed values needed by the public first-view Demo."""
    analysis = reviewed["analysis"]
    sectors = analysis["sectors"]
    sector_analysis = sectors["analysis"]
    reference_points = analysis["track"]["reference"]
    coach_summary = analysis.get("ai_coach_summary") or {}
    priorities = coach_summary.get("training_priorities") or []
    narrative = analysis.get("narrative")

    return {
        "schema_version": 1,
        "provenance": {
            **reviewed["provenance"],
            "privacy_review_status": reviewed["privacy_review"]["status"],
            "private_identifiers_removed": reviewed["privacy_review"][
                "private_identifiers_removed"
            ],
        },
        "display": reviewed["display"],
        "fastest_lap": analysis["fastest_lap"],
        "lap_rows": analysis["lap_rows"],
        "track": {
            "lap_length_m": analysis["track"]["lap_length_m"],
            "points": [
                {
                    "distance_m": point["distance_m"],
                    "local_x_m": point["local_x_m"],
                    "local_y_m": point["local_y_m"],
                }
                for point in _uniform_thumbnail(
                    reference_points,
                    TRACK_THUMBNAIL_MAX_POINTS,
                )
            ],
        },
        "sector_loss": {
            "source": sectors["source"],
            "official": sectors["official"],
            "sector_best": sectors["sector_best"],
            "laps": [
                {
                    "lap": row["lap"],
                    "total_loss_s": row["total_loss"],
                    "sector_losses": {
                        key.removesuffix("_loss"): value
                        for key, value in row.items()
                        if key.startswith("sector_") and key.endswith("_loss")
                    },
                }
                for row in sector_analysis["sector_loss"]
            ],
        },
        "summary": {
            "source": "llm" if narrative else "structured",
            "narrative": narrative or analysis["report"],
            "bullets": [
                priority["what_to_test"]
                for priority in priorities[:3]
                if priority.get("what_to_test")
            ],
        },
        "synthetic_curve_generated": False,
    }


def load_demo_session_resource() -> DemoSessionResponse:
    """Load and validate the bundled resource once during module import."""
    resource = files(__package__).joinpath(RESOURCE_NAME)
    payload = json.loads(resource.read_text(encoding="utf-8"))
    return DemoSessionResponse.model_validate(payload)


def _uniform_thumbnail(points: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Retain evenly distributed source points, including both endpoints."""
    if len(points) <= limit:
        return points
    indexes = {
        round(index * (len(points) - 1) / (limit - 1))
        for index in range(limit)
    }
    return [points[index] for index in sorted(indexes)]
