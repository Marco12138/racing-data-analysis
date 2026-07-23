"""API and orchestration tests for temporary AiM imports."""

from __future__ import annotations

import asyncio
import csv
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.api import import_routes
from backend.app.core.config import Settings
from backend.app.importers.service import (
    AimImportError,
    ImportRateLimiter,
    allocate_rows,
)
from backend.app.main import create_app
from backend.app.utils import storage


def write_converter_output(output_dir: Path) -> None:
    """Create deterministic converter artifacts for an API test."""
    output_dir.mkdir(parents=True)
    with (output_dir / "laps.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=["lap", "lap_time", "sector_1", "sector_2", "sector_3", "notes"],
        )
        writer.writeheader()
        writer.writerows(
            [
                {
                    "lap": 1,
                    "lap_time": 42.0,
                    "sector_1": 14.0,
                    "sector_2": 14.1,
                    "sector_3": 13.9,
                    "notes": "derived_equal_distance_sectors",
                },
                {
                    "lap": 2,
                    "lap_time": 41.5,
                    "sector_1": 13.8,
                    "sector_2": 13.9,
                    "sector_3": 13.8,
                    "notes": "derived_equal_distance_sectors",
                },
            ]
        )
    with (output_dir / "telemetry.csv").open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(
            file,
            fieldnames=["time", "lap", "distance", "speed", "rpm", "gps_lat", "gps_lon"],
        )
        writer.writeheader()
        for lap in [1, 2]:
            for index in range(8):
                writer.writerow(
                    {
                        "time": index / 2,
                        "lap": lap,
                        "distance": index * 20,
                        "speed": 70 + index,
                        "rpm": 8000 + index * 10,
                        "gps_lat": 30.0,
                        "gps_lon": 114.0,
                    }
                )
    report = {
        "source": {
            "name": "fixture.xrk",
            "path": "/private/tmp/secret/fixture.xrk",
            "size_bytes": 1234,
            "sha256": "abc",
            "original_modified": False,
        },
        "metadata": {
            "Driver": "Marco",
            "Vehicle": "Kart",
            "Venue": "WSK-WUHAN",
            "Log Date": "05/26/2025",
        },
        "lap_selection": {"valid_laps": [1, 2], "excluded_laps": []},
        "virtual_sectors": {
            "method": "equal_distance_thirds",
            "derived_not_official": True,
            "boundaries_m": [270.0, 540.0],
        },
        "channels": [
            {"name": "GPS Speed", "units": "m/s", "samples": 16, "status": "used"}
        ],
        "warnings": ["Sector times are derived, not official."],
    }
    (output_dir / "extraction_report.json").write_text(
        json.dumps(report),
        encoding="utf-8",
    )


def test_aim_import_returns_normalized_path_free_response(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    """A valid import should return rows and remove its temporary directory."""
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    observed_temp: Path | None = None

    async def fake_conversion(source: Path, output_dir: Path, _: int) -> None:
        nonlocal observed_temp
        observed_temp = source.parent
        assert source.read_bytes() == b"synthetic-xrk"
        write_converter_output(output_dir)

    monkeypatch.setattr(import_routes, "run_xrk_conversion", fake_conversion)
    settings = Settings(
        app_env="test",
        app_mode="cloud",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
        max_xrk_upload_bytes=1024,
    )

    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/imports/aim",
            files={"file": ("session.xrk", b"synthetic-xrk", "application/octet-stream")},
        )

    assert response.status_code == 200
    body = response.json()
    assert body["format"] == "aim_xrk"
    assert body["metadata"]["Driver"] == "Marco"
    assert body["lap_analysis"]["fastest_lap"]["lap"] == 2
    assert len(body["lap_rows"]) == 2
    assert len(body["telemetry_rows"]) == 16
    assert body["virtual_sectors"]["derived_not_official"] is True
    assert "path" not in body["source"]
    assert observed_temp is not None and not observed_temp.exists()


@pytest.mark.parametrize("filename", ["session.csv", "session.drk", "session.txt"])
def test_aim_import_rejects_unsupported_extensions(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    filename: str,
) -> None:
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
    )
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/imports/aim",
            files={"file": (filename, b"not-xrk", "application/octet-stream")},
        )
    assert response.status_code == 400
    assert ".xrk and .xrz" in response.json()["detail"]


def test_aim_import_enforces_size_and_timeout_errors(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        max_xrk_upload_bytes=1024,
    )
    with TestClient(create_app(settings)) as client:
        too_large = client.post(
            "/api/v1/imports/aim",
            files={"file": ("large.xrk", b"x" * 1025, "application/octet-stream")},
        )
        assert too_large.status_code == 413

        async def timeout(*_: object) -> None:
            raise AimImportError("XRK parsing exceeded the 60 second limit.", 504)

        monkeypatch.setattr(import_routes, "run_xrk_conversion", timeout)
        timed_out = client.post(
            "/api/v1/imports/aim",
            files={"file": ("slow.xrk", b"xrk", "application/octet-stream")},
        )
        assert timed_out.status_code == 504


@pytest.mark.parametrize(
    ("message", "status_code"),
    [
        ("Unable to parse the XRK/XRZ file.", 400),
        ("No complete timed laps passed the GPS quality checks.", 422),
        ("XRK parser is unavailable on this server.", 503),
    ],
)
def test_aim_import_preserves_parser_error_contract(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    message: str,
    status_code: int,
) -> None:
    monkeypatch.setattr(storage, "DB_PATH", tmp_path / "sessions.sqlite3")

    async def fail(*_: object) -> None:
        raise AimImportError(message, status_code)

    monkeypatch.setattr(import_routes, "run_xrk_conversion", fail)
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'sessions.sqlite3'}",
        allowed_hosts="testserver",
        cors_origins="https://frontend.example",
    )
    with TestClient(create_app(settings)) as client:
        response = client.post(
            "/api/v1/imports/aim",
            files={"file": ("session.xrk", b"xrk", "application/octet-stream")},
        )
        preflight = client.options(
            "/api/v1/imports/aim",
            headers={
                "Origin": "https://frontend.example",
                "Access-Control-Request-Method": "POST",
            },
        )
    assert response.status_code == status_code
    assert response.json()["detail"] == message
    assert preflight.status_code == 200
    assert preflight.headers["access-control-allow-origin"] == "https://frontend.example"


def test_rate_limiter_blocks_after_allowance() -> None:
    async def exercise() -> None:
        limiter = ImportRateLimiter(limit=2)
        await limiter.check("client")
        await limiter.check("client")
        with pytest.raises(AimImportError) as error:
            await limiter.check("client")
        assert error.value.status_code == 429

    asyncio.run(exercise())


def test_row_allocation_respects_budget_and_lap_coverage() -> None:
    allocations = allocate_rows([1000, 2000, 3000], 300)
    assert sum(allocations) == 300
    assert all(allocation >= 2 for allocation in allocations)
    assert allocations[0] < allocations[1] < allocations[2]
