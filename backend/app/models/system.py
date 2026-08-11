"""Public system and deployment capability models."""

from __future__ import annotations

from pydantic import BaseModel


class PersistenceCapability(BaseModel):
    """Non-secret status of the active metadata ownership boundary."""

    metadata_backend: str
    ownership_mode: str
    owner_scoped_entities: list[str]
    multi_user_ready: bool


class XrkServerImportCapability(BaseModel):
    """Runtime XRK parser capability safe to expose to browser clients."""

    enabled: bool
    available: bool
    parser: str
    version: str | None
    license: str | None
    status: str
    platform: str
    max_upload_bytes: int
    timeout_seconds: int
    error_code: str | None = None
    message: str | None = None


class LlmNarrativeCapability(BaseModel):
    """Whether the optional LLM narrative layer is configured (never the key)."""

    available: bool
    model: str | None = None


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
    aim_imports: bool
    persistence: PersistenceCapability
    xrk_server_import: XrkServerImportCapability
    llm_narrative: LlmNarrativeCapability


class HealthStatus(BaseModel):
    """Liveness or readiness response."""

    status: str
    service: str
    version: str
