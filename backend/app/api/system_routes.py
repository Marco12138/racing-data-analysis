"""Health, version, and deployment capability endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from ..models.system import DeploymentCapabilities, HealthStatus
from ..utils.storage import check_database

router = APIRouter(prefix="/system", tags=["system"])


def public_health() -> dict[str, str]:
    """Return the stable health contract used by public hosting providers."""
    return {"status": "ok"}


@router.get("/capabilities", response_model=DeploymentCapabilities)
def capabilities(request: Request) -> DeploymentCapabilities:
    """Describe active deployment capabilities for the frontend."""
    settings = request.app.state.settings
    return DeploymentCapabilities(
        environment=settings.app_env,
        mode=settings.app_mode,
        api_version=settings.app_version,
        local_video_library=settings.local_video_enabled,
        direct_uploads=False,
        persistent_object_storage=False,
        durable_task_queue=False,
        authentication=False,
        aim_imports=True,
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
