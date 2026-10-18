"""Private five-second clip audit. Never update browser anchors or publish media."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
import sys
import tempfile

import cv2
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.app.analysis.xrk_session_analysis import analyze_xrk_session
from backend.app.importers.xrk_inspection import inspect_xrk_file


def interpolate(rows: list[dict], at: float, x: str, y: str, max_gap: float) -> float:
    """Bound interpolation to adjacent real samples; reject gaps and extrapolation."""
    present = [r[x] for r in rows if r.get(x) is not None]
    if not math.isfinite(at) or any(not math.isfinite(v) for v in present) or any(
        right <= left for left, right in zip(present, present[1:])
    ):
        raise ValueError("Nonfinite or nonmonotonic time/distance axis")
    for index, right in enumerate(rows):
        if right.get(x) is None or right[x] < at:
            continue
        if right[x] == at and right.get(y) is not None and math.isfinite(right[y]):
            return float(right[y])
        if index == 0:
            break
        left = rows[index - 1]
        if any(p.get(k) is None for p in (left, right) for k in (x, y)):
            break
        if any(not math.isfinite(p[k]) for p in (left, right) for k in (x, y)):
            break
        gap = right[x] - left[x]
        if not 0 < gap <= max_gap:
            break
        return float(left[y] + (right[y] - left[y]) * (at - left[x]) / gap)
    raise ValueError(f"Unavailable bounded interpolation: {x}={at}")


def lap_trace(analysis: dict, lap: int) -> list[dict]:
    """Use the same real-lap data sources as the review interface."""
    for side in ("target", "reference"):
        if analysis[f"{side}_lap"] == lap:
            return analysis["track"][side]
    return [{"distance_m": row["distance_m"], **{
        key: row.get(f"lap_{lap}_{key}") for key in ("session_time_s", "speed")
    }} for row in analysis["top_laps_comparison"]["aligned"]]


def make_windows(analysis: dict, anchor_lap: int, offset: float, targets: list[int],
                 extra: list[float]) -> list[dict]:
    """Choose one source start position, then locate that position in each real lap."""
    source = lap_trace(analysis, anchor_lap)
    specs = []
    for segment in analysis["top_lap_segments"]["segments"]:
        inside = [r for r in source if segment["entry_m"] <= r["distance_m"] <= segment["exit_m"]
                  and r.get("speed") is not None and r.get("session_time_s") is not None]
        focus = min(inside, key=lambda row: row["speed"])
        start_s = focus["session_time_s"] - 2
        start_m = interpolate(source, start_s, "session_time_s", "distance_m", 1)
        specs.append((segment["id"], start_m))
    specs.extend((f"extra_{index+1}", distance) for index, distance in enumerate(extra))
    windows = []
    for name, distance in specs:
        clips = {}
        for lap in [anchor_lap, *targets]:
            trace = lap_trace(analysis, lap)
            start = interpolate(trace, distance, "distance_m", "session_time_s", 10)
            end_m = interpolate(trace, start + 5, "session_time_s", "distance_m", 1)
            clips[str(lap)] = {"lap": lap, "start_s": start + offset, "end_s": start + offset + 5,
                               "telemetry_start_s": start, "end_distance_m": end_m}
        windows.append({"id": name, "start_distance_m": distance, "clips": clips})
    return windows


def main() -> None:
    """Reparse XRK, extract local frames and prepare bounded visual comparisons."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", required=True, type=Path)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--anchor-lap", type=int, default=4)
    parser.add_argument("--anchor-video-start", type=float, required=True)
    parser.add_argument("--anchor-status", choices=["user_confirmed", "prior_offset_provisional"], required=True)
    parser.add_argument("--anchor-uncertainty-s", type=float, default=0)
    parser.add_argument("--target-laps", type=int, nargs="+", default=[5, 6])
    parser.add_argument("--extra-start-distance", type=float, nargs="*", default=[])
    parser.add_argument("--gps-warning-window", type=float, nargs=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not 0 <= args.anchor_uncertainty_s <= 2:
        parser.error("Manual pick uncertainty must be between 0 and 2 seconds.")
    output = args.output.resolve()
    if output == Path("tmp").resolve() or not output.is_relative_to(Path("tmp").resolve()):
        parser.error("Private output must remain under tmp/.")
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="review-boundary-") as temporary:
        manifest = inspect_xrk_file(args.file.expanduser(), Path(temporary))
        analysis = analyze_xrk_session(pd.read_parquet(Path(temporary)/"telemetry.parquet"), manifest,
                                       target_lap=args.anchor_lap, language="zh")
    timing = next(row for row in analysis["video_sync"]["lap_video_ranges"] if row["lap"] == args.anchor_lap)
    offset = args.anchor_video_start - timing["telemetry_start_s"]
    windows = make_windows(analysis, args.anchor_lap, offset, args.target_laps, args.extra_start_distance)
    ranges = {row["lap"]: row for row in analysis["video_sync"]["lap_video_ranges"]}
    gate_clips = {}
    for lap in [args.anchor_lap, *args.target_laps]:
        at = ranges[lap]["telemetry_start_s"]
        gate_clips[str(lap)] = {"lap": lap, "start_s": at+offset, "end_s": at+offset+5,
                               "telemetry_start_s": at,
                               "end_distance_m": interpolate(lap_trace(analysis, lap), at+5, "session_time_s", "distance_m", 1)}
    windows.insert(0, {"id": "lap_start", "start_distance_m": 0, "source": "logger_lap_boundary",
                       "clips": gate_clips})
    capture = cv2.VideoCapture(str(args.video.expanduser()))
    if not capture.isOpened():
        raise ValueError("Local video could not be opened")
    fps, count = capture.get(cv2.CAP_PROP_FPS), int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    requested = set()

    def frame_ref(time: float) -> dict:
        """Track real frame quantization; no fabricated subframe measurements."""
        index = int(round(time * fps))
        if not 0 <= index < count:
            raise ValueError("Requested frame lies outside original video")
        requested.add(index)
        return {"frame": str(index), "time_s": index / fps}

    pairs = []
    anchor_frames = [frame_ref(float(t)) for t in np.linspace(
        args.anchor_video_start-args.anchor_uncertainty_s,
        args.anchor_video_start+args.anchor_uncertainty_s, 11)]
    for window in windows:
        reference = window["clips"][str(args.anchor_lap)]
        for lap in args.target_laps:
            target = window["clips"][str(lap)]
            checks = []
            for boundary in ("start", "end"):
                at = target[f"{boundary}_s"]
                start = max(ranges[lap]["telemetry_start_s"] + offset, at - 2)
                end = min(ranges[lap]["telemetry_end_s"] + offset, at + 2)
                control_times = np.linspace(ranges[lap]["telemetry_start_s"] + offset + .2,
                                            ranges[lap]["telemetry_end_s"] + offset - .2, 24)
                controls = [t for t in control_times if abs(t - at) > 3]
                checks.append({"boundary": boundary, "reference_frame": frame_ref(reference[f"{boundary}_s"])["frame"],
                               "predicted": frame_ref(at), "search": [frame_ref(float(t)) for t in np.linspace(start, end, 25)],
                               "controls": [frame_ref(float(t)) for t in controls]})
            warning = args.gps_warning_window
            overlap = max(0, min(target["telemetry_start_s"] + 5, warning[1]) - max(target["telemetry_start_s"], warning[0])) if warning else 0
            pairs.append({"id": window["id"], "reference_lap": args.anchor_lap, "target_lap": lap,
                          "reference": reference, "target": target, "start_distance_m": window["start_distance_m"],
                          "end_position_difference_m": target["end_distance_m"] - reference["end_distance_m"],
                          "gps_warning_overlap_s": overlap, "checks": checks,
                          "manual_confirmation": "pending", "anchor_updated": False})
        for clip in window["clips"].values():
            clip["frames"] = [frame_ref(clip["start_s"] + dt) for dt in (0, 2.5, 5)]

    frame_dir = output/"frames"
    frame_dir.mkdir(exist_ok=True)
    previous = -999
    for number, index in enumerate(sorted(requested)):
        if index - previous > 45:
            capture.set(cv2.CAP_PROP_POS_FRAMES, index)
        else:
            for _ in range(index - previous - 1):
                if not capture.grab():
                    raise ValueError("Video frame decoding failed")
        ok, frame = capture.read()
        if not ok:
            raise ValueError(f"Video frame decoding failed: {index}")
        actual = int(round(capture.get(cv2.CAP_PROP_POS_FRAMES))) - 1
        if actual != index:
            raise ValueError(f"Frame seek mismatch: {actual} != {index}")
        small = cv2.resize(frame, (320, 180), interpolation=cv2.INTER_AREA)
        (frame_dir/f"{index}.rgba").write_bytes(cv2.cvtColor(small, cv2.COLOR_BGR2RGBA).tobytes())
        cv2.imwrite(str(frame_dir/f"{index}.jpg"), cv2.resize(frame, (640, 360)), [cv2.IMWRITE_JPEG_QUALITY, 88])
        previous = index
        if number % 100 == 0:
            print(f"Decoded {number+1}/{len(requested)} real frames", flush=True)
    capture.release()
    result = {"anchor": {"lap": args.anchor_lap, "video_start_s": args.anchor_video_start,
                         "offset_s": offset, "status": args.anchor_status, "overwritten": False},
              "video": {"path": str(args.video.expanduser().resolve()), "size_bytes": args.video.stat().st_size,
                        "fps": fps, "frame_count": count}, "xrk_fingerprint": manifest["fingerprint"],
              "width": 320, "height": 180, "clip_duration_s": 5, "windows": windows, "pairs": pairs,
              "regions": [{"name": "left_trackside", "rect": {"x": .02, "y": .25, "w": .34, "h": .25}},
                          {"name": "forward_trackside", "rect": {"x": .28, "y": .20, "w": .30, "h": .20}}],
              "limitations": ["No human ground-truth labels", "Five seconds need not end at the same position",
                              "Image similarity does not establish synchronization", "No anchor or production data is updated"]}
    result["anchor"].update({"user_estimated_uncertainty_s": args.anchor_uncertainty_s,
                            "uncertainty_is_statistical_interval": False, "frames": anchor_frames})
    (output/"analysis.json").write_text(json.dumps(analysis, ensure_ascii=False, allow_nan=False))
    (output/"frames.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    print(json.dumps({"pairs": len(pairs), "frames": len(requested), "anchor": result["anchor"]}))


if __name__ == "__main__":
    main()
