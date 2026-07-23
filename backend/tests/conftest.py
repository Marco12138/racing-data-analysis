"""Shared fixtures for local video API tests."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest


@pytest.fixture
def sample_video(tmp_path: Path) -> Path:
    """Create a short deterministic MP4 fixture."""
    path = tmp_path / "sample.mp4"
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 20.0, (320, 180))
    if not writer.isOpened():
        pytest.skip("OpenCV MP4 writer is unavailable")
    for index in range(40):
        frame = np.zeros((180, 320, 3), dtype=np.uint8)
        frame[:, :, 1] = 35 + index * 3
        cv2.putText(frame, f"FRAME {index}", (45, 95), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        writer.write(frame)
    writer.release()
    return path
