"""Exclude demo and unresolved feedback without treating a client claim as proof."""

import re

from fastapi import Request

from ..importers.inspection_store import InspectionExpiredError
from ..utils.storage import load_storyboard
from .errors import PublicApiError


def feedback_origin(request: Request, *, declared: str = "unknown", token: str | None = None,
                    fingerprint: str | None = None, node_id: str | None = None) -> str:
    """Resolve a real source, reject demo votes, and quarantine unverifiable history."""
    if declared == "demo" or token == "published-demo" or fingerprint in {"redacted", "published-demo"}:
        raise PublicApiError(422, "DEMO_FEEDBACK_DISABLED", "Demo feedback is disabled. Import your own session to submit a review.")
    if token and re.fullmatch(r"[0-9a-f]{32}", token):
        try:
            record = request.app.state.xrk_inspection_store.load(token)
        except InspectionExpiredError:
            if declared == "real":
                raise PublicApiError(410, "XRK_INSPECTION_EXPIRED", "The feedback session has expired. Please import it again.") from None
        else:
            if fingerprint is not None and fingerprint != record.manifest.get("fingerprint"):
                raise PublicApiError(422, "FEEDBACK_SOURCE_MISMATCH", "Feedback does not match the inspected session.")
            return "real"
    if token and node_id:
        story = load_storyboard(token)
        if story and story.get("data_origin") == "real" and any(n.get("id") == node_id for n in story.get("nodes", [])):
            return "real"
    if declared == "real":
        raise PublicApiError(422, "FEEDBACK_SOURCE_UNVERIFIED", "The feedback source could not be verified.")
    return "unknown"
