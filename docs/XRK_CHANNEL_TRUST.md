# XRK Channel Trust: P0

## Scope

This phase repairs channel provenance, sensor capability reporting, native
timebase retention and gap-safe processing. It does not change Lap Quality
Gate or Top 3 consensus rules. No synthetic reference lap is generated.

## Confirmed From Code

- Previously, GPS yaw could satisfy `has_gyro`; GPS acceleration could satisfy
  `has_accelerometer`. These flags now require recognized raw sensor channels.
- `AccelerometerX/Y/Z`, `GyroX/Y/Z` and existing raw-axis aliases are separate
  from GPS-derived longitudinal/lateral acceleration and yaw.
- `present` means a channel exists, not that it is calibrated. Exact all-zero
  values are retained. All-zero gear remains unusable, but is not absent.
- Sensor-family `*_present` requires readable samples; `*_channels_present`
  records schema presence separately. `*_informative` is false for unreadable
  or entirely zero channels. Zero is not evidence of hardware failure.
- `sensor_capabilities.body_dynamics_available` stays false until independently
  validated calibration exists. Raw X/Y/Z are never assigned body axes here.
- Each channel records source, evidence class, original unit, native rate,
  timestamps, timing anomalies and selection reason. Unknown dynamics units
  produce unavailable normalized values, never an assumed conversion.
- The inspection token now owns `native_channels.parquet`: channel ID, original
  sample index, original millisecond timestamp and numeric value. Duplicate and
  invalid samples remain auditable. The manifest supplies original names/units.
- `telemetry.parquet` remains the Dashboard table. Continuous downsampling uses
  a sixth-order zero-phase Butterworth low-pass at 0.4 of destination Hz within
  contiguous segments. Short/unfilterable segments remain unavailable.
- Time-domain resampling does not extrapolate or cross gaps exceeding
  `max(0.5 seconds, 5 native median intervals)`. Missing values remain missing
  through RPM smoothing/derivatives and distance-domain comparison.
- Native files share the existing fixed inspection expiry and deletion path.
  No raw arrays are returned to the LLM; only summarized source metadata is added.
  Cloud file-access restrictions and API origin validation are unchanged.

## Reproducible Private Audit

Run from the repository root in the existing Python environment:

```bash
export XRK_TEST_DATA_DIR="$HOME/racing数据"
python scripts/audit_xrk_channels.py --output tmp/xrk-channel-audit
# Alternatively, select one private file with XRK_TEST_FILE_PATH or --file.
XRK_TEST_FILE_PATH=/private/path/sample.xrk python scripts/audit_xrk_channels.py
```

The script reads originals without deleting/modifying them; only its temporary
derived cache is deleted. `summary.json` and `report.md` contain private filenames
and analysis, must stay local and must not be committed. `tmp/` is ignored.
Upload requests continue to delete their temporary original after parsing.

Per-file results distinguish logger-valid laps from reference-eligible quality
gate results. GPS lateral acceleration is compared with speed times GPS yaw;
GPS longitudinal acceleration with backward and centered speed derivatives.
Metrics include finite pair count, correlation, signed bias, RMS and maximum
absolute residual. Speed is converted to m/s, yaw to radians/s and acceleration
to g using 9.80665 m/s2. Jerk is reported in g/s.

Welch PSD describes output signal power, not sensor hardware bandwidth. The
reported power above display Nyquist is an information-loss indicator, not a
calibrated sensor limit. Raw-axis lag scans use fixed signs and three windows;
positive lag compares GPS(t) with gyro(t + lag). They are exploratory candidates,
not applied synchronization or independent validation.

Spectral cleanup retains the first strictly increasing timestamp subsequence
and reports dropped counts; a duplicate does not disable the complete PSD.
The native cache remains unchanged. Lateral identity checks report both the
uniform-grid result and an exact shared-native-timestamp result (first duplicate
observation, no interpolation). These methods need not have identical residuals.
Longitudinal checks retain the largest residual timestamps for manual receiver/
gap review; they do not automatically label GPS reacquisition as the cause.

## Evidence And Release Status

The local private audit has been exercised on real files; detailed measured
results are deliberately outside this repository. Automated tests use small
synthetic signals only. Private acceptance uses either `XRK_TEST_DATA_DIR` (each
file separately) or `XRK_TEST_FILE_PATH` (takes precedence). Without either, it is
explicitly skipped. A configured empty directory fails instead of silently skipping.
Every native array is compared with direct libxrk output, including NaN; known
GPS-only 0809 and six-axis IMU 0898 have separate regression assertions.

Run every release check in DEPLOYMENT.md, plus:

```bash
python -m pytest backend/tests/test_native_channels.py -q
XRK_TEST_DATA_DIR="$HOME/racing数据" python -m pytest backend/tests -q
# For a single private file, including an IMU file:
XRK_TEST_FILE_PATH=/private/path/sample.xrk python -m pytest backend/tests/test_xrk_real_sample.py -q
pnpm run test:frontend
pnpm run test:xrk-trust
```

Local Docker/Compose verification requires Docker, which was unavailable on the
development machine during this phase. Do not mark the complete release gate
green or deploy solely on Python/JavaScript tests.

## Not Yet Validated: P1

Reliable stationary-segment calibration, forward-axis observability, independent
calibration/validation laps, multi-band lag stability and body-dynamic quality
gates remain P1. GPS corner phase segmentation also remains P1. No body-frame
yaw response, roll/pitch, side-slip, tire grip utilization, wheel-hop, confirmed
wheel lift or mechanical diagnosis is enabled by this change.

## Changed Files

- Import/cache: `backend/app/importers/xrk_inspection.py`,
  `native_signals.py`, `inspection_store.py`.
- Analysis/source propagation: `backend/app/analysis/channel_audit.py`,
  `gps_processing.py`, `rpm_analysis.py`, `xrk_session_analysis.py`,
  `llm_narrative.py`.
- Local audit: `scripts/audit_xrk_channels.py`.
- UI/types: `frontend/components/XrkInspectionWorkspace.tsx`,
  `frontend/lib/xrkAnalysisApi.ts`.
- Tests: `backend/tests/test_native_channels.py`,
  `backend/tests/test_xrk_real_sample.py`, `tests/xrk-channel-trust.test.mjs`.
- Checks/documentation: `package.json`, `docs/DEPLOYMENT.md`, this document.
