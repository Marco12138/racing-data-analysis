"""OpenCV-based metadata and sparse keyframe analysis for local videos."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np


class VideoAnalysisError(RuntimeError):
    """Raised when OpenCV cannot inspect the selected media."""


def analyze_video(video_path: Path, output_dir: Path, sample_count: int = 12) -> dict:
    """Read metadata and save evenly distributed keyframes with quality metrics."""
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise VideoAnalysisError("OpenCV could not open the selected video.")

    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS))
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
        if fps <= 0 or frame_count <= 0 or width <= 0 or height <= 0:
            raise VideoAnalysisError("The video metadata is incomplete or invalid.")
        duration = frame_count / fps
        fourcc_value = int(capture.get(cv2.CAP_PROP_FOURCC))
        codec = "".join(chr((fourcc_value >> (8 * index)) & 0xFF) for index in range(4)).strip()
        output_dir.mkdir(parents=True, exist_ok=True)

        keyframes = []
        timestamps = np.linspace(0, duration * 0.95, sample_count)
        for index, timestamp in enumerate(timestamps):
            capture.set(cv2.CAP_PROP_POS_MSEC, float(timestamp * 1000))
            ok, frame = capture.read()
            if not ok:
                continue
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            brightness = float(np.mean(gray))
            sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            preview = _resize_preview(frame, max_width=960)
            filename = f"keyframe_{index + 1:02d}.jpg"
            target = output_dir / filename
            cv2.imwrite(str(target), preview, [cv2.IMWRITE_JPEG_QUALITY, 88])
            keyframes.append(
                {
                    "index": index + 1,
                    "timestamp": round(float(timestamp), 3),
                    "filename": filename,
                    "brightness": round(brightness, 2),
                    "sharpness": round(sharpness, 2),
                }
            )

        if not keyframes:
            raise VideoAnalysisError("No representative frames could be decoded.")

        metadata = {
            "duration_seconds": round(duration, 3),
            "fps": round(fps, 5),
            "frame_count": frame_count,
            "width": width,
            "height": height,
            "resolution": f"{width}x{height}",
            "codec": codec or "unknown",
            "file_size_bytes": video_path.stat().st_size,
        }
        return {
            "metadata": metadata,
            "keyframes": keyframes,
            "report": generate_video_report(metadata, keyframes),
        }
    finally:
        capture.release()


def generate_video_report(metadata: dict, keyframes: list[dict]) -> str:
    """Generate a conservative video-only review from verified technical findings."""
    average_brightness = np.mean([frame["brightness"] for frame in keyframes])
    average_sharpness = np.mean([frame["sharpness"] for frame in keyframes])
    quality = "清晰度满足逐帧复盘" if average_sharpness >= 80 else "部分画面可能存在运动模糊"
    exposure = "整体曝光正常" if 45 <= average_brightness <= 210 else "曝光波动较大，复盘时需谨慎"
    duration = format_timestamp(metadata["duration_seconds"])
    return "\n\n".join(
        [
            f"视频时长 {duration}，分辨率 {metadata['resolution']}，帧率 {metadata['fps']:.2f} fps，编码 {metadata['codec']}。",
            f"已抽取 {len(keyframes)} 张代表关键帧。{quality}；{exposure}。",
            "当前仅有视频，可用于时间轴回放、圈段标记、转向动作和线路位置的人工对比。",
            "未提供圈速、sector 或遥测数据，因此不能量化 sector 损失、真实车速、制动压力、油门开度，也不输出转向不足或转向过度结论。",
            "建议先标记每圈开始与结束，再挑选相同弯角的视频时刻进行并排复盘；后续补充圈速或 Race Studio 3 CSV 后再做定量关联。",
        ]
    )


def format_timestamp(seconds: float) -> str:
    """Format seconds as HH:MM:SS.mmm."""
    milliseconds = int(round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    secs, millis = divmod(remainder, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def _resize_preview(frame: np.ndarray, max_width: int) -> np.ndarray:
    """Resize a frame for responsive keyframe previews without upscaling."""
    height, width = frame.shape[:2]
    if width <= max_width:
        return frame
    scale = max_width / width
    return cv2.resize(frame, (max_width, int(height * scale)), interpolation=cv2.INTER_AREA)
