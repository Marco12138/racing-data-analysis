"""Public system and deployment capability models."""

from __future__ import annotations

from pydantic import BaseModel


class DeploymentCapabilities(BaseModel):
    """Feature availability exposed to clients without leaking secrets."""

    environment: str
    mode: str
    api_version: str
    local_video_library: bool
    direct_uploads: bool
    persistent_object_storage: bool
    durable_task_queue: bool
    authentication: bool


class HealthStatus(BaseModel):
    """Liveness or readiness response."""

    status: str
    service: str
    version: str
