"""Mock-only regression tests; private logs and audio never become fixtures."""

import json

import numpy as np
import pandas as pd
import pytest
from scipy.ndimage import gaussian_filter1d

from backend.app.analysis.rpm_sync_verification import _grid, verify_rpm_alignment
from backend.tests.test_video_telemetry_sync import build_client, seed_inspection


def signals(offset=7.3, start=0., duration=90.):
    """Generate an aperiodic test-only RPM signal with a known clock shift."""
    times = np.arange(start, start+duration, .1)
    rpm = 10000 + gaussian_filter1d(np.random.default_rng(23).normal(size=len(times)), 6)*4000
    telemetry = [{"time_s": float(t), "rpm": float(v)} for t, v in zip(times, rpm)]
    video = [{"time_s": float(t-start+offset), "rpm": float(.9*v+300)} for t, v in zip(times, rpm)]
    return video, telemetry


def test_precise_candidate_still_requires_human_review():
    """Strong multi-window agreement must never become confirmed ground truth."""
    video, telemetry = signals()
    result = verify_rpm_alignment(video, telemetry)
    assert result["offset_ms"] == pytest.approx(7300, abs=50)
    assert result["status"] == "candidate"
    assert result["requires_manual_confirmation"] is True
    assert result["manually_confirmed"] is False
    assert len(result["evidence"]["windows"]) == 5
    assert result["evidence"]["window_offset_spread_s"] <= .1
    assert result["evidence"]["confidence_kind"] == "heuristic_not_probability"
    json.dumps(result, allow_nan=False)


def test_selected_late_lap_keeps_session_clock():
    """A cropped video can map to a late session without rebasing telemetry."""
    video, telemetry = signals(start=650, duration=42)
    result = verify_rpm_alignment(video, telemetry, selected_lap=13)
    assert result["offset_ms"] == pytest.approx(-642700, abs=50)
    assert result["evidence"]["selected_lap"] == 13
    assert result["evidence"]["telemetry_time_range_s"][0] == 650


def test_repeated_patterns_are_ambiguous_not_confirmed():
    """A different lap's identical waveform is a competing candidate."""
    times = np.arange(0, 150, .1)
    rows = [{"time_s": float(t), "rpm": float(9000+3000*np.sin(t*2*np.pi/20))} for t in times]
    result = verify_rpm_alignment(rows, rows)
    assert result["status"] == "ambiguous"
    assert "REPEATED_LAP_AMBIGUITY" in result["evidence"]["reason_codes"]
    assert result["reliable"] is False


def test_selected_lap_in_multi_lap_video_cannot_be_trusted_just_from_score():
    """Even a unique highest peak cannot establish lap identity in a long video."""
    video, telemetry = signals(duration=150)
    result = verify_rpm_alignment(video, telemetry[400:800], selected_lap=2)
    assert "VIDEO_SPANS_MULTIPLE_LAPS" in result["evidence"]["reason_codes"]
    assert result["status"] == "ambiguous"
    assert result["reliable"] is False


def test_competing_audio_methods_expose_disagreement():
    """Two plausible acoustic sources must not silently pick different laps."""
    video, telemetry = signals()
    alternative = [{**r, "time_s": r["time_s"]+10} for r in video]
    result = verify_rpm_alignment(video, telemetry, alternative_video_rpm=alternative)
    assert result["status"] == "ambiguous"
    assert "AUDIO_METHOD_DISAGREEMENT" in result["evidence"]["reason_codes"]
    assert len(result["evidence"]["alternatives"]) == 1


def test_gaps_and_invalid_values_do_not_become_matching_samples():
    """Analysis resampling must leave long gaps and invalid runs unavailable."""
    _, rows = signals()
    rows = [r for r in rows if not 30 < r["time_s"] < 42]
    for row in rows:
        if 55 < row["time_s"] < 60:
            row["rpm"] = float("nan")
    grid, values, processing = _grid(rows, .1)
    assert np.isnan(values[(grid > 30.1) & (grid < 41.9)]).all()
    assert np.isnan(values[(grid > 55.2) & (grid < 59.8)]).all()
    assert processing["extrapolation"] is False


def test_short_or_flat_signal_cannot_create_trust():
    """Limited samples may suggest timing, never pass the multi-window gate."""
    video, telemetry = signals(duration=20)
    result = verify_rpm_alignment(video, telemetry)
    assert result["status"] == "weak"
    assert "INSUFFICIENT_WINDOWS" in result["evidence"]["reason_codes"]
    flat = [{**r, "rpm": 8000} for r in telemetry]
    with pytest.raises(ValueError, match="No audio method"):
        verify_rpm_alignment(flat, flat)


def test_clock_reversal_and_work_limits_reject():
    """Invalid clocks and huge spans are rejected before expensive work."""
    video, telemetry = signals()
    with pytest.raises(ValueError, match="monotonic"):
        verify_rpm_alignment(video[::-1], telemetry)
    with pytest.raises(ValueError, match="one hour"):
        verify_rpm_alignment(video, [{**r, "time_s": r["time_s"]*100} for r in telemetry])


def test_api_verification_is_additive_and_path_free(monkeypatch, tmp_path):
    """New clients receive evidence while old callers keep their contract."""
    client = build_client(monkeypatch, tmp_path)
    video, rows = signals()
    with client:
        response = client.post('/api/v1/xrk/video-sync/rpm', json={
            'video_rpm':video, 'telemetry_rpm':rows, 'verification':True,
        })
        assert response.status_code == 200, response.text
        assert response.json()['evidence']['method'] == 'audio_rpm_multi_window_v1'
        assert response.json()['request_id']
        rejected = client.post('/api/v1/xrk/video-sync/rpm', json={
            'video_rpm':video, 'telemetry_rpm':rows, 'verification':True, 'video_path':'/private/video.mp4',
        })
        assert rejected.status_code == 422


def test_api_uses_native_rpm_instead_of_lossy_display_grid(monkeypatch, tmp_path):
    """Only a matching native RPM channel inside the token may be consumed."""
    client = build_client(monkeypatch, tmp_path)
    video, rows = signals(start=650, duration=42)
    display = pd.DataFrame(rows).rename(columns={'time_s':'session_time_s'}).assign(lap=13, rpm=8000)
    with client:
        token = seed_inspection(client, display)
        record = client.app.state.xrk_inspection_store.load(token)
        manifest = record.manifest
        manifest['channels'] = [{'canonical_name':'rpm','available':True,'channel_id':'c1'}]
        manifest['lap_timing'] = [{'lap':13, 'start_time_ms':650000, 'end_time_ms':692000}]
        manifest['artifacts']['native_channels'] = 'native_channels.parquet'
        (record.directory/'inspection.json').write_text(json.dumps(manifest))
        pd.DataFrame({'channel_id':'c1','timecode_ms':[r['time_s']*1000 for r in rows],
                      'value':[r['rpm'] for r in rows]}).to_parquet(record.directory/'native_channels.parquet')
        response = client.post('/api/v1/xrk/video-sync/rpm', json={
            'inspection_id':token, 'lap':13, 'video_rpm':video, 'verification':True,
        })
    assert response.status_code == 200, response.text
    assert response.json()['evidence']['telemetry_timebase'] == 'native_rpm'
    assert response.json()['offset_ms'] == pytest.approx(-642700, abs=50)


def test_corrupt_native_cache_returns_a_public_error(monkeypatch, tmp_path):
    """Unreadable native data must not expose a filesystem path to clients."""
    from backend.app.analysis import rpm_sync_verification

    client = build_client(monkeypatch, tmp_path)
    video, rows = signals()
    display = pd.DataFrame(rows).rename(columns={'time_s':'session_time_s'}).assign(lap=1)

    def fail_native(*args):
        """Emulate a damaged private cache artifact."""
        raise OSError('/private/cache/native_channels.parquet is damaged')

    monkeypatch.setattr(rpm_sync_verification, 'native_rpm_for_sync', fail_native)
    with client:
        token = seed_inspection(client, display)
        response = client.post('/api/v1/xrk/video-sync/rpm', json={
            'inspection_id':token, 'video_rpm':video, 'verification':True,
        })
    assert response.status_code == 422
    assert response.json()['error_code'] == 'VIDEO_SYNC_TELEMETRY_UNAVAILABLE'
    assert '/private/' not in response.text
