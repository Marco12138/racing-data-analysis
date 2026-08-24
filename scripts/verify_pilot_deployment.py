#!/usr/bin/env python3
"""Verify the public Coach Pilot deployment without uploading user data."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urlparse


DEFAULT_FRONTEND_URL = "https://ai-racing-telemetry-platform.vercel.app"
DEFAULT_API_URL = "https://racing-ai-platform-api-production.up.railway.app"


def _https_origin(value: str, label: str) -> str:
    """Validate and normalize a public HTTPS origin."""
    parsed = urlparse(value.rstrip("/"))
    if parsed.scheme != "https" or not parsed.hostname or parsed.path not in {"", "/"}:
        raise ValueError(f"{label} must be a public HTTPS origin.")
    if parsed.hostname in {"localhost", "127.0.0.1", "::1"}:
        raise ValueError(f"{label} must not use a loopback host.")
    return value.rstrip("/")


def _get_json(url: str, timeout: float) -> dict[str, Any]:
    """Fetch a JSON object with a bounded timeout."""
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "User-Agent": "racing-pilot-verifier/1"},
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        if response.status != 200:
            raise RuntimeError(f"{url} returned HTTP {response.status}.")
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise RuntimeError(f"{url} did not return a JSON object.")
    return payload


def verify_pilot(
    frontend_url: str,
    api_url: str,
    *,
    timeout: float = 15.0,
    require_llm: bool = False,
) -> list[str]:
    """Return human-readable checks or raise when a critical gate fails."""
    frontend = _https_origin(frontend_url, "Frontend URL")
    api = _https_origin(api_url, "API URL")

    health = _get_json(f"{api}/api/v1/health", timeout)
    if health != {"status": "ok"}:
        raise RuntimeError("Public health contract is not ready.")

    readiness = _get_json(f"{api}/api/v1/system/health/ready", timeout)
    if readiness.get("status") != "ready":
        raise RuntimeError("Railway database readiness check did not pass.")

    capabilities = _get_json(f"{api}/api/v1/system/capabilities", timeout)
    xrk = capabilities.get("xrk_server_import") or {}
    llm = capabilities.get("llm_narrative") or {}
    if capabilities.get("environment") != "production" or capabilities.get("mode") != "cloud":
        raise RuntimeError("API is not reporting the production cloud boundary.")
    if not xrk.get("available"):
        raise RuntimeError(f"XRK parser is unavailable: {xrk.get('error_code') or 'unknown'}.")
    if require_llm and not llm.get("available"):
        raise RuntimeError("LLM narrative is required but unavailable.")

    runtime = _get_json(f"{frontend}/api/runtime-config", timeout)
    upload_url = str(runtime.get("xrkUploadUrl") or "")
    if not upload_url.startswith(f"{api}/api/v1/xrk/inspect"):
        raise RuntimeError("Frontend XRK upload target does not match the Railway API.")
    if runtime.get("apiOrigin") != frontend:
        raise RuntimeError("Frontend API origin is not using the expected same-origin route.")

    return [
        "public health: ok",
        "database readiness: ready",
        f"XRK parser: {xrk.get('parser')} {xrk.get('version') or ''}".strip(),
        f"LLM narrative: {'available' if llm.get('available') else 'fallback only'}",
        "runtime config: Vercel same-origin + direct Railway XRK upload",
    ]


def main(argv: list[str] | None = None) -> int:
    """Run the verification CLI."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend-url", default=DEFAULT_FRONTEND_URL)
    parser.add_argument("--api-url", default=DEFAULT_API_URL)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--require-llm", action="store_true")
    args = parser.parse_args(argv)

    try:
        checks = verify_pilot(
            args.frontend_url,
            args.api_url,
            timeout=args.timeout,
            require_llm=args.require_llm,
        )
    except (ValueError, RuntimeError, urllib.error.URLError, TimeoutError) as exc:
        print(f"Coach Pilot verification failed: {exc}", file=sys.stderr)
        return 1

    print("Coach Pilot deployment checks passed:")
    for check in checks:
        print(f"- {check}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
