"""Synthetic-only contract tests; no private racing fixture is stored here."""

from datetime import UTC, datetime, timedelta
import json
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

from backend.app.analysis.channel_audit import comparison_metrics
from backend.app.analysis.gps_processing import resample_lap_by_distance
from backend.app.analysis.rpm_analysis import smooth_rpm_signal, calculate_rpm_derivative
from backend.app.analysis.llm_narrative import build_xrk_narrative_evidence
from backend.app.analysis.xrk_session_analysis import evidence_catalog
from backend.app.importers.inspection_store import InspectionExpiredError, InspectionStore
from backend.app.importers.native_signals import bounded_resample, native_frame, save_native_channels, timestamp_quality
from backend.app.importers.xrk_inspection import convert_units, inspect_channels, sensor_capabilities
from backend.tests.test_xrk_import import FakeTable


def test_sources_do_not_overwrite_and_raw_axes_are_not_body_axes():
    """GPS yaw and physical gyro remain distinct regardless of channel order."""
    channels = {name: FakeTable(name, [0, 20, 40], [0, 1, 2]) for name in (
        "GPS_Yaw_Rate", "GyroZ", "GyroX", "AccelerometerX", "Accel Y", "AccZ", "GPS_LateralAcc"
    )}
    descriptions, resolved = inspect_channels(SimpleNamespace(channels=channels))
    reverse, reverse_resolved = inspect_channels(SimpleNamespace(channels=dict(reversed(list(channels.items())))))
    assert resolved == reverse_resolved
    assert resolved["yaw_rate"] == "GPS_Yaw_Rate"
    assert resolved["gyro_z"] == "GyroZ"
    assert resolved["accel_x"] == "AccelerometerX"
    assert "longitudinal_g" not in resolved
    cap = sensor_capabilities(descriptions)
    assert cap["gyro_present"] and cap["accelerometer_present"]
    assert not cap["body_dynamics_available"]
    gps = [r for r in reverse if r["source"] == "gps_derived"]
    assert not sensor_capabilities(gps)["gyro_present"]
    assert not sensor_capabilities(gps)["accelerometer_present"]


def test_zeros_and_original_time_order_survive_cache(tmp_path):
    """Stationary gyro zeros and faulty original timestamps are preserved."""
    times = [0, 20, 40, 40, 30, 60, 80, 2000]
    log = SimpleNamespace(channels={"GyroZ": FakeTable("GyroZ", times, [0]*8)})
    descriptions, resolved = inspect_channels(log)
    assert resolved["gyro_z"] == "GyroZ"
    assert descriptions[0]["present"] and descriptions[0]["available"]
    assert descriptions[0]["all_zero"]
    path = tmp_path/"native.parquet"
    assert save_native_channels(log, descriptions, path) == 8
    cached = pd.read_parquet(path)
    assert cached.timecode_ms.tolist() == times
    assert cached.value.tolist() == [0]*8
    quality = timestamp_quality(native_frame(log.channels["GyroZ"], "GyroZ"))
    assert quality["duplicate_timestamp_count"] == 1
    assert quality["backward_timestamp_count"] == 1
    assert quality["long_gap_count"] == 1


def test_resampling_never_extrapolates_or_bridges_gaps():
    """Invalid samples and long gaps break interpolation; real zeros survive."""
    t = np.array([0., .1, .2, .3, 2., 2.1])
    values = np.array([0., 1., np.nan, 3., 4., 5.])
    target = np.array([-.1, 0, .05, .15, .25, 1., 2.05, 2.2])
    output, method = bounded_resample(t, values, target)
    assert output[1] == 0
    assert output[2] == pytest.approx(.5)
    assert output[6] == pytest.approx(4.5)
    assert np.isnan(output[[0, 3, 4, 5, 7]]).all()
    assert method["extrapolation"] is False


def test_antialias_suppresses_out_of_band_energy():
    """A test-only 23Hz tone must not fold into a 10Hz display grid."""
    source = np.arange(0, 20, .01)
    target = np.arange(0, 20, .1)
    values = np.sin(2*np.pi*23*source)
    output, method = bounded_resample(source, values, target)
    assert np.std(output[20:-20]) < .01
    assert method["anti_alias_filter"] == "butterworth_order6_zero_phase"
    assert method["cutoff_hz"] == pytest.approx(4)


def test_units_metrics_and_source_catalog():
    """GPS-derived values never enter the measured or independent IMU bucket."""
    assert convert_units("speed", np.array([10.]), "m/s")[0] == 36
    assert convert_units("gyro_z", np.array([np.pi]), "rad/s")[0] == pytest.approx(180)
    assert convert_units("accel_x", np.array([9.80665]), "m/s^2")[0] == pytest.approx(1)
    assert np.isnan(convert_units("gyro_z", np.array([1.]), None)).all()
    assert np.isnan(convert_units("speed", np.array([1.]), "unknown")).all()
    metrics = comparison_metrics(np.array([1., 3.]), np.array([0., 2.]))
    assert metrics["bias"] == metrics["rms"] == metrics["max_absolute_error"] == 1
    provenance = {"yaw_rate": {"name":"GPS_Yaw_Rate", "source":"gps_derived", "evidence_class":"calculated"}}
    catalog = evidence_catalog({"available_canonical_channels":["yaw_rate"], "channel_provenance":provenance})
    assert catalog["measured"] == []
    assert any("GPS_Yaw_Rate" in item for item in catalog["calculated"])
    evidence = build_xrk_narrative_evidence({"channel_provenance":provenance,"native_channels":[123456]})
    assert evidence["channel_sources"]["yaw_rate"]["source"] == "gps_derived"
    assert "123456" not in json.dumps(evidence)


def test_native_cache_deleted_at_fixed_expiry(tmp_path):
    """Adding a native artifact must not extend or bypass token retention."""
    store = InspectionStore(tmp_path, 1800)
    token, directory, expiry = store.create_directory()
    pd.DataFrame({"time":[0]}).to_parquet(directory/"telemetry.parquet")
    pd.DataFrame({"value":[0]}).to_parquet(directory/"native_channels.parquet")
    payload = {"artifacts":{"telemetry":"telemetry.parquet","native_channels":"native_channels.parquet"}}
    (directory/"inspection.json").write_text(json.dumps(payload))
    record = store.finalize(token, directory, expiry)
    assert record.native_channels_path.is_file()
    assert store.load(token).expires_at == expiry
    payload["expires_at"] = (datetime.now(UTC)-timedelta(seconds=1)).isoformat()
    (directory/"inspection.json").write_text(json.dumps(payload))
    with pytest.raises(InspectionExpiredError):
        store.load(token)
    assert not directory.exists()


def test_downstream_smoothing_and_comparison_preserve_missing_channels():
    """A display or derivative must not silently refill a preserved outage."""
    time = np.arange(30) * .1
    rpm = 8000 + time * 100
    rpm[8:20] = np.nan
    frame = pd.DataFrame({"lap": 1, "lap_time_s": time, "session_time_s": time,
                          "distance_m": time*10, "rpm": rpm, "speed": 40.})
    processed = calculate_rpm_derivative(smooth_rpm_signal(frame))
    assert processed.loc[8:19, "rpm_smoothed"].isna().all()
    assert processed.loc[8:19, "rpm_slope"].isna().all()
    resampled = resample_lap_by_distance(processed, .5)
    assert resampled.loc[resampled.distance_m.between(8, 19), "rpm"].isna().all()


def test_derivative_does_not_cross_a_missing_time_interval():
    """Timestamp outages must not become large synthetic derivative spikes."""
    frame = pd.DataFrame({"lap_time_s": [0., .1, .2, 10., 10.1, 10.2],
                          "rpm": [8000., 8001., 8002., 9000., 9001., 9002.]})
    result = calculate_rpm_derivative(frame)
    assert np.allclose(result.rpm_slope, 10.)
