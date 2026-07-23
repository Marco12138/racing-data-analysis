"""Task dispatch boundary for local background work and future queue workers."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, Protocol

from fastapi import BackgroundTasks, HTTPException, status

from .config import Settings


class TaskDispatcher(Protocol):
    """Minimal interface implemented by inline and future queue adapters."""

    def enqueue(self, task: Callable[..., Any], *args: Any) -> None:
        """Schedule one task for execution."""


class InlineTaskDispatcher:
    """Run tasks through FastAPI background tasks for local single-process use."""

    def __init__(self, background_tasks: BackgroundTasks) -> None:
        self._background_tasks = background_tasks

    def enqueue(self, task: Callable[..., Any], *args: Any) -> None:
        """Schedule a task after the response is sent."""
        self._background_tasks.add_task(task, *args)


def task_dispatcher(settings: Settings, background_tasks: BackgroundTasks) -> TaskDispatcher:
    """Return the configured dispatcher without silently emulating a cloud queue."""
    if settings.task_queue_backend == "inline":
        return InlineTaskDispatcher(background_tasks)
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail=(
            "Redis task dispatch is configured but no worker adapter is enabled. "
            "Deploy the queue worker before accepting analysis jobs."
        ),
    )


VideoAnalysisTask = Callable[[str, Path], None]
