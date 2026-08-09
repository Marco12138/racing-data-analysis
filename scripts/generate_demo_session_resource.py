#!/usr/bin/env python3
"""Generate the backend Demo resource from the reviewed public artifact.

Optional `--generate-narrative` mode asks the configured OpenAI-compatible
endpoint for a coach narrative from the reviewed analysis evidence. The result
is written back into the source artifact so it goes through the same human
review before the compact resource is rebuilt. Without LLM configuration, or
when generation fails, the compact resource keeps the structured summary.
"""

from __future__ import annotations

import argparse
import asyncio
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
    parser.add_argument(
        "--generate-narrative",
        action="store_true",
        help=(
            "Generate an LLM narrative from the reviewed analysis evidence and "
            "write it back into the source artifact for review."
        ),
    )
    args = parser.parse_args()

    reviewed = json.loads(args.source.read_text(encoding="utf-8"))
    if args.generate_narrative:
        _generate_reviewed_narrative(reviewed, args.source)
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


def _generate_reviewed_narrative(reviewed: dict, source: Path) -> None:
    """Generate a narrative from the reviewed analysis and persist it for review."""
    from backend.app.analysis.llm_narrative import (
        build_xrk_narrative_evidence,
        generate_llm_narrative,
    )

    evidence = build_xrk_narrative_evidence(reviewed["analysis"])
    narrative = asyncio.run(generate_llm_narrative(evidence))
    if not narrative:
        print(
            "LLM narrative not generated (unconfigured or failed); "
            "the compact resource keeps the structured summary.",
            file=sys.stderr,
        )
        return
    reviewed.setdefault("analysis", {})["narrative"] = narrative
    source.write_text(
        json.dumps(reviewed, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(
        "Generated LLM narrative written to the source artifact. "
        "Human-review it before publishing.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
