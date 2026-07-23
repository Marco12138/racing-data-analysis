"""Tests for sparse OpenCV video analysis."""

from __future__ import annotations

from pathlib import Path

from backend.app.analysis.video_analysis import analyze_video, format_timestamp


def test_analyze_video_extracts_metadata_and_keyframes(sample_video: Path, tmp_path: Path) -> None:
    """A valid video should produce metadata and the requested keyframes."""
    result = analyze_video(sample_video, tmp_path / "frames", sample_count=12)

    assert result["metadata"]["resolution"] == "320x180"
    assert result["metadata"]["frame_count"] == 40
    assert result["metadata"]["fps"] == 20.0
    assert len(result["keyframes"]) == 12
    assert all((tmp_path / "frames" / frame["filename"]).is_file() for frame in result["keyframes"])
    assert "不能量化 sector 损失" in result["report"]


def test_format_timestamp_includes_milliseconds() -> None:
    """Video marker exports use a stable HH:MM:SS.mmm format."""
    assert format_timestamp(65.1) == "00:01:05.100"
