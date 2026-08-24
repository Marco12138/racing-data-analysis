"""Health, version, and deployment capability endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from ..models.system import (
    DeploymentCapabilities,
    HealthStatus,
    LlmNarrativeCapability,
    PersistenceCapability,
    XrkServerImportCapability,
)
from ..analysis.llm_narrative import _llm_config
from ..utils.storage import check_database

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/health")
def public_health() -> dict[str, str]:
    """Return the stable health contract used by public hosting providers."""
    return {"status": "ok"}


@router.get("/capabilities", response_model=DeploymentCapabilities)
def capabilities(request: Request) -> DeploymentCapabilities:
    """Describe active deployment capabilities for the frontend."""
    settings = request.app.state.settings
    parser_probe = request.app.state.xrk_parser_registry.probe()
    llm_config = _llm_config()
    return DeploymentCapabilities(
        environment=settings.app_env,
        mode=settings.app_mode,
        api_version=settings.app_version,
        local_video_library=settings.local_video_enabled,
        direct_uploads=False,
        persistent_object_storage=False,
        durable_task_queue=False,
        authentication=False,
        aim_imports=parser_probe.available,
        persistence=PersistenceCapability(
            metadata_backend="sqlite",
            ownership_mode="anonymous",
            owner_scoped_entities=["sessions", "video_jobs", "video_markers"],
            multi_user_ready=False,
        ),
        xrk_server_import=XrkServerImportCapability(
            enabled=settings.xrk_server_import_enabled,
            available=parser_probe.available,
            parser=parser_probe.name,
            version=parser_probe.version,
            license=parser_probe.license,
            status=parser_probe.status,
            platform=parser_probe.platform,
            max_upload_bytes=settings.max_xrk_upload_bytes,
            timeout_seconds=settings.xrk_parse_timeout_seconds,
            error_code=parser_probe.error_code,
            message=parser_probe.message,
        ),
        llm_narrative=LlmNarrativeCapability(
            available=llm_config is not None,
            model=llm_config[2] if llm_config is not None else None,
        ),
    )


@router.get("/health/live", response_model=HealthStatus)
def liveness(request: Request) -> HealthStatus:
    """Confirm that the API process is accepting requests."""
    settings = request.app.state.settings
    return HealthStatus(status="ok", service=settings.app_name, version=settings.app_version)


@router.get("/health/ready", response_model=HealthStatus)
def readiness(request: Request) -> HealthStatus:
    """Confirm that required local persistence is reachable."""
    settings = request.app.state.settings
    try:
        check_database()
    except (OSError, RuntimeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Database is not ready: {exc}",
        ) from exc
    return HealthStatus(status="ready", service=settings.app_name, version=settings.app_version)
