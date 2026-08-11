"""FastAPI application factory for local and hosted environments."""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from .api.analysis_routes import analyze_session, router as analysis_router
from .api.cross_session_routes import router as cross_session_router
from .api.errors import PublicApiError
from .api.feedback_routes import router as feedback_router
from .api.import_routes import router as import_router
from .api.system_routes import (
    capabilities,
    liveness,
    public_health,
    router as system_router,
)
from .api.storyboard_routes import router as storyboard_router
from .api.video_routes import router as video_router
from .api.xrk_routes import router as xrk_router
from .core.config import Settings, get_settings
from .importers.inspection_store import InspectionStore
from .importers.service import ImportRateLimiter
from .importers.xrk_registry import XrkParserRegistry
from .utils.storage import init_db
from .utils.video_library import cleanup_video_cache


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build a configured FastAPI application."""
    active_settings = settings or get_settings()
    inspection_store = InspectionStore(
        Path(active_settings.xrk_inspection_cache_dir),
        active_settings.xrk_inspection_ttl_seconds,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        init_db()
        inspection_store.cleanup()
        if active_settings.local_video_enabled:
            cleanup_video_cache(active_settings.video_cache_ttl_seconds)
        yield

    application = FastAPI(
        title=active_settings.app_name,
        version=active_settings.app_version,
        docs_url="/docs" if active_settings.docs_enabled else None,
        redoc_url="/redoc" if active_settings.docs_enabled else None,
        openapi_url="/openapi.json" if active_settings.docs_enabled else None,
        lifespan=lifespan,
    )
    application.state.settings = active_settings
    application.state.xrk_import_semaphore = asyncio.Semaphore(
        active_settings.xrk_max_concurrent_imports
    )
    application.state.xrk_rate_limiter = ImportRateLimiter(
        active_settings.xrk_rate_limit_per_hour
    )
    application.state.xrk_inspection_store = inspection_store
    application.state.xrk_parser_registry = XrkParserRegistry(
        configured_parser=active_settings.xrk_parser,
        enabled=active_settings.xrk_server_import_enabled,
    )
    application.add_middleware(
        TrustedHostMiddleware,
        allowed_hosts=active_settings.allowed_host_list or ["*"],
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=active_settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Location"],
    )

    @application.middleware("http")
    async def request_context(request: Request, call_next):
        request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        response.headers["X-API-Version"] = active_settings.app_version
        return response

    @application.exception_handler(PublicApiError)
    async def public_api_error_handler(
        request: Request,
        exc: PublicApiError,
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", uuid.uuid4().hex)
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "status": "error",
                "error_code": exc.error_code,
                "message": exc.message,
                "request_id": request_id,
            },
            headers={"X-Request-ID": request_id},
        )

    application.include_router(system_router, prefix=active_settings.api_v1_prefix)
    application.include_router(analysis_router, prefix=active_settings.api_v1_prefix)
    application.include_router(feedback_router, prefix=active_settings.api_v1_prefix)
    application.include_router(import_router, prefix=active_settings.api_v1_prefix)
    application.include_router(xrk_router, prefix=active_settings.api_v1_prefix)
    application.include_router(cross_session_router, prefix=active_settings.api_v1_prefix)
    application.include_router(storyboard_router, prefix=active_settings.api_v1_prefix)
    application.include_router(video_router, prefix=active_settings.api_v1_prefix)
    application.add_api_route(
        f"{active_settings.api_v1_prefix}/health",
        public_health,
        methods=["GET"],
        tags=["system"],
    )
    application.add_api_route(
        f"{active_settings.api_v1_prefix}/capabilities",
        capabilities,
        methods=["GET"],
        tags=["system"],
    )

    # Backward-compatible MVP paths. New clients should use /api/v1.
    application.add_api_route("/health", liveness, methods=["GET"], include_in_schema=False)
    application.add_api_route("/api/analyze", analyze_session, methods=["POST"], include_in_schema=False)
    application.include_router(video_router, prefix="/api", include_in_schema=False)
    return application


app = create_app()
