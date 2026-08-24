"""Tests for the public Coach Pilot deployment verifier."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import pytest


SCRIPT_PATH = Path(__file__).resolve().parents[2] / "scripts" / "verify_pilot_deployment.py"
SPEC = importlib.util.spec_from_file_location("verify_pilot_deployment", SCRIPT_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def _responses() -> dict[str, dict[str, Any]]:
    api = MODULE.DEFAULT_API_URL
    frontend = MODULE.DEFAULT_FRONTEND_URL
    return {
        f"{api}/api/v1/health": {"status": "ok"},
        f"{api}/api/v1/system/health/ready": {"status": "ready"},
        f"{api}/api/v1/system/capabilities": {
            "environment": "production",
            "mode": "cloud",
            "xrk_server_import": {"available": True, "parser": "libxrk", "version": "0.12.0"},
            "llm_narrative": {"available": True, "model": "deepseek-chat"},
        },
        f"{frontend}/api/runtime-config": {
            "apiOrigin": frontend,
            "apiPrefix": "/api/v1",
            "xrkUploadUrl": f"{api}/api/v1/xrk/inspect",
            "deploymentMode": "public-demo",
        },
    }


def test_verify_pilot_accepts_consistent_railway_deployment(monkeypatch: pytest.MonkeyPatch) -> None:
    """All critical public boundaries should pass together."""
    responses = _responses()
    monkeypatch.setattr(MODULE, "_get_json", lambda url, timeout: responses[url])

    checks = MODULE.verify_pilot(
        MODULE.DEFAULT_FRONTEND_URL,
        MODULE.DEFAULT_API_URL,
        require_llm=True,
    )

    assert "database readiness: ready" in checks
    assert any("libxrk" in check for check in checks)


def test_verify_pilot_rejects_mismatched_upload_target(monkeypatch: pytest.MonkeyPatch) -> None:
    """The browser must not silently upload XRK files to another backend."""
    responses = _responses()
    responses[f"{MODULE.DEFAULT_FRONTEND_URL}/api/runtime-config"]["xrkUploadUrl"] = (
        "https://wrong.example/api/v1/xrk/inspect"
    )
    monkeypatch.setattr(MODULE, "_get_json", lambda url, timeout: responses[url])

    with pytest.raises(RuntimeError, match="does not match"):
        MODULE.verify_pilot(MODULE.DEFAULT_FRONTEND_URL, MODULE.DEFAULT_API_URL)


@pytest.mark.parametrize("url", ["http://example.com", "https://127.0.0.1:8000"])
def test_verify_pilot_rejects_unsafe_origins(url: str) -> None:
    """Production verification must preserve HTTPS and loopback protections."""
    with pytest.raises(ValueError):
        MODULE.verify_pilot(url, MODULE.DEFAULT_API_URL)
