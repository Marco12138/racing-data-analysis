"""Synthetic clocks test synchronization only; never used as driver evidence."""

from datetime import UTC, datetime
import json

import numpy as np
import pandas as pd
import pytest

from backend.app.analysis.gnss_sync import GPS_EPOCH, WEEK_S, gps_utc_offset, verify_gnss_alignment
from backend.tests.test_video_telemetry_sync import build_client, seed_inspection


def fixture(offset=23.7, duration=180., date="2025-03-24T10:45:00"):
    """Independent camera and logger timebases with known varying speeds."""
    epoch = datetime.fromisoformat(date).replace(tzinfo=UTC).timestamp()
    t = np.arange(0, duration, .1)
    speed = 60+15*np.sin(t/4)+6*np.sin(t/1.6)
    lat, lon = 30+.001*np.sin(t/10), 114+.001*np.cos(t/10)
    tow = ((epoch+gps_utc_offset(epoch)-GPS_EPOCH+t) % WEEK_S)
    ref = {"series": {"tow": (t, tow), "speed": (t, speed), "gps_lat": (t, lat), "gps_lon": (t, lon), "gps_fix": (t, np.full(len(t), 3.))},
           "metadata": {"Log Date": datetime.fromtimestamp(epoch, UTC).strftime("%m/%d/%Y")},
           "lap_timing": [{"lap": 1, "start_time_ms": 10000, "end_time_ms": 50000}]}
    clock = [{"time_s": float(s+offset), "utc_s": float(epoch+s), "fix": 3} for s in t[::10]]
    gps = [{"time_s": float(s+offset), "speed_kmh": float(v), "lat": float(a), "lon": float(b), "fix": 3}
           for s, v, a, b in zip(t, speed, lat, lon)]
    return clock, gps, ref


def test_clock_speed_and_position_agreement_is_not_frame_truth():
    """Independent check blocks and source caveats survive a perfect match."""
    result = verify_gnss_alignment(*fixture())
    assert result["offset_ms"] == pytest.approx(23700, abs=50)
    assert result["status"] == "candidate"
    assert result["manually_confirmed"] is False
    assert result["body_dynamics_available"] is False
    assert result["evidence"]["speed_check"]["validation_samples"] >= 2
    assert result["evidence"]["spatial_check"]["p95_error_m"] < .01
    assert result["evidence"]["lap_coverage"] == [{"lap": 1, "coverage": "full"}]
    assert "AIM_TIME_VALIDITY_UNEXPOSED" in result["evidence"]["reason_codes"]
    json.dumps(result, allow_nan=False)


def test_quantized_tow_keeps_warning_and_can_be_refined():
    """Held 1s receiver messages are not precise per-sample UTC observations."""
    clock, gps, ref = fixture()
    t, tow = ref["series"]["tow"]
    ref["series"]["tow"] = (t, np.floor(tow))
    result = verify_gnss_alignment(clock, gps, ref)
    assert "AIM_TOW_QUANTIZED" in result["evidence"]["reason_codes"]
    assert result["offset_ms"] == pytest.approx(23700, abs=55)
    assert result["evidence"]["aim_tow_step_s"] == 1


@pytest.mark.parametrize("fault,code", [("date", "GNSS_SESSION_DATE_MISMATCH"),
    ("fix", "GOPRO_GPS_FIX_UNAVAILABLE"), ("reverse", "GNSS_CLOCK_NONMONOTONIC"),
    ("location", "GNSS_LOCATION_MISMATCH"), ("reset", "AIM_TOW_RESET")])
def test_bad_inputs_fail_closed(fault, code):
    """Wrong sessions, invalid fixes and reset clocks must not be synchronized."""
    clock, gps, ref = fixture()
    if fault == "date":
        ref["metadata"]["Log Date"] = "03/01/2025"
    elif fault == "fix":
        clock = [{**p, "fix": 0} for p in clock]
    elif fault == "reverse":
        clock.reverse()
    elif fault == "location":
        gps = [{**p, "lat": p["lat"]+1} for p in gps]
    elif fault == "reset":
        ref["series"]["tow"][1][800:] -= 30
    with pytest.raises(ValueError, match=code):
        verify_gnss_alignment(clock, gps, ref)


def test_no_gps_speed_downgrades_and_no_extrapolation():
    """Absolute-clock candidates alone cannot verify lap identity or accuracy."""
    clock, _, ref = fixture()
    result = verify_gnss_alignment(clock, [], ref)
    assert result["status"] == "weak"
    assert result["evidence"]["speed_check"] == {}
    assert result["requires_manual_confirmation"]
    assert result["evidence"]["matched_video_range_s"][0] >= clock[0]["time_s"]


def test_week_rollover_and_historical_leap_seconds():
    """A GPS week boundary is not a device reset; historical leap counts vary."""
    result = verify_gnss_alignment(*fixture(date="2025-03-22T23:59:10"))
    assert result["offset_ms"] == pytest.approx(23700, abs=50)
    assert gps_utc_offset(datetime(2016, 8, 1, tzinfo=UTC).timestamp()) == 17
    assert gps_utc_offset(datetime(2025, 8, 1, tzinfo=UTC).timestamp()) == 18


@pytest.mark.parametrize("tow_value,code", [(0, "AIM_TOW_UNAVAILABLE"), (100000, "GNSS_CLOCK_UNSTABLE")])
def test_missing_or_frozen_receiver_time(tow_value, code):
    """A channel name alone is not evidence of a running GNSS clock."""
    clock, gps, ref = fixture()
    ref["series"]["tow"][1][:] = tow_value
    with pytest.raises(ValueError, match=code):
        verify_gnss_alignment(clock, gps, ref)


def test_low_excitation_cannot_pass_speed_validation():
    """Constant speed cannot independently resolve repeated lap timing."""
    clock, gps, ref = fixture()
    ref["series"]["speed"][1][:] = 40
    gps = [{**p, "speed_kmh": 40} for p in gps]
    result = verify_gnss_alignment(clock, gps, ref)
    assert result["status"] == "weak"
    assert "GNSS_SPEED_VALIDATION_INSUFFICIENT" in result["evidence"]["reason_codes"]


def test_missing_aim_fix_cannot_be_promoted_to_verified_candidate():
    """Absent receiver quality flags are an explicit limitation."""
    clock, gps, ref = fixture()
    del ref["series"]["gps_fix"]
    result = verify_gnss_alignment(clock, gps, ref)
    assert result["status"] == "weak"
    assert "AIM_GPS_FIX_UNAVAILABLE" in result["evidence"]["reason_codes"]


def test_invalid_aim_fix_masks_clock_and_speed():
    """Values recorded with no receiver fix are never used for synchronization."""
    clock, gps, ref = fixture()
    ref["series"]["gps_fix"][1][:] = 0
    with pytest.raises(ValueError, match="AIM_TOW_UNAVAILABLE"):
        verify_gnss_alignment(clock, gps, ref)


def test_drift_is_reported_not_silently_applied():
    """A constant-offset player must not claim to correct substantial drift."""
    clock, gps, ref = fixture(duration=240)
    for p in clock:
        p["utc_s"] += .002 * p["time_s"]
    result = verify_gnss_alignment(clock, gps, ref)
    assert result["status"] == "weak"
    assert "CLOCK_DRIFT_REQUIRES_ANCHORS" in result["evidence"]["reason_codes"]
    assert result["evidence"]["drift_correction_applied"] is False


def test_api_reads_token_cache_not_filesystem_or_client_aim_data(monkeypatch, tmp_path):
    """Cloud API accepts only bounded metadata and an existing private token."""
    clock, gps, ref = fixture()
    client = build_client(monkeypatch, tmp_path)
    with client:
        token = seed_inspection(client, pd.DataFrame({"lap": [1], "session_time_s": [1], "rpm": [9000]}))
        record = client.app.state.xrk_inspection_store.load(token)
        rows, channels = [], []
        for i, (key, (t, v)) in enumerate(ref["series"].items()):
            channels.append({"channel_id": str(i), "canonical_name": None if key == "tow" else key,
                             "normalized_name": "timtpitow" if key == "tow" else key, "available": True,
                             "source": "unknown" if key == "tow" else "gps_receiver",
                             "unit": {"tow": "ms", "speed": "km/h", "gps_fix": ""}.get(key, "deg")})
            rows.extend({"channel_id": str(i), "timecode_ms": a*1000, "value": b*(1000 if key == "tow" else 1)} for a, b in zip(t, v))
        manifest = {**record.manifest, "channels": channels, "metadata": ref["metadata"], "lap_timing": ref["lap_timing"]}
        manifest["artifacts"]["native_channels"] = "native_channels.parquet"
        (record.directory/"inspection.json").write_text(json.dumps(manifest))
        pd.DataFrame(rows).to_parquet(record.directory/"native_channels.parquet")
        payload = {"inspection_id": token, "video_clock": clock, "video_gps": gps}
        response = client.post("/api/v1/xrk/video-sync/gnss", json=payload)
        assert response.status_code == 200, response.text
        assert response.json()["request_id"]
        assert response.json()["offset_ms"] == pytest.approx(23700, abs=50)
        assert client.post("/api/v1/xrk/video-sync/gnss", json={**payload, "video_path": "/private/test"}).status_code == 422
        assert client.post("/api/v1/xrk/video-sync/gnss", json={**payload, "video_clock": clock*30}).status_code == 422
        broken = {**payload, "video_clock": [{**clock[0], "time_s": -1}, *clock[1:]]}
        assert client.post("/api/v1/xrk/video-sync/gnss", json=broken).status_code == 422
        wrong_date = {**payload, "video_clock": [{**p, "utc_s": p["utc_s"]-10*86400} for p in clock]}
        failed = client.post("/api/v1/xrk/video-sync/gnss", json=wrong_date)
        assert failed.status_code == 422
        assert failed.json()["error_code"] == "GNSS_SESSION_DATE_MISMATCH"
        assert "/private" not in failed.text and "Traceback" not in failed.text
        client.app.state.xrk_inspection_store.delete(token)
        assert client.post("/api/v1/xrk/video-sync/gnss", json=payload).status_code == 410
