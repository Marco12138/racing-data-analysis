#!/usr/bin/env python3
"""Generate the backend Demo resource from the reviewed public artifact."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY_ROOT))

from backend.app.models.demo_session import DemoSessionResponse
from backend.app.resources.demo_session import build_demo_session_payload


def main() -> None:
    """Write a deterministic, schema-validated compact Demo artifact."""
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("public/demo/reviewed-real-session.json"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("backend/app/resources/demo_session.json"),
    )
    args = parser.parse_args()

    reviewed = json.loads(args.source.read_text(encoding="utf-8"))
    payload = build_demo_session_payload(reviewed)
    validated = DemoSessionResponse.model_validate(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(
            validated.model_dump(mode="json"),
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
