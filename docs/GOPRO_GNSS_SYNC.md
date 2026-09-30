# GoPro GNSS synchronization validation (Beta)

This is an additional candidate source, not an automatic replacement for manual
anchors or audio/RPM alignment. Recorder start/end times need not coincide.
Neither LLMs nor learned vision models participate. Lap quality, Top 3, phases,
and driver-action detectors are unchanged.

## Data Flow

1. In Single Lap Analysis, select the real target lap and local GoPro original.
2. **GoPro timing check / GoPro 时间校验** reads the MP4 sample table and only
   `gpmd` packets via sparse Blob reads. No video or audio decoding/upload occurs.
3. `GPS5`, `GPSU`, `GPSF`, `SCAL`, and `UNIT`/`SIUN` yield GPS time, position and
   speed. The file creation date is never used as GPS UTC. GPS9 is detected but
   not yet validated and cannot generate a timing candidate in this version.
4. Only bounded GPS summaries and the existing inspection token are posted to
   `POST /api/v1/xrk/video-sync/gnss`. Camera IMU values stay local; only their
   presence/sample count/rate is shown. No camera-to-body calibration is claimed.
5. The server reads native AiM `TimTpItow`, GPS fix, speed and position from the
   token's existing Parquet cache. It never accepts a server path or client AiM
   reference arrays. Speed and position require `gps_receiver` provenance.
   Missing/expired caches use the existing error contract.
6. GPS week is inferred from camera UTC, cross-checked against the logger date.
   Historical GPS-minus-UTC leap offsets are applied, not a timezone guess.
   Actual week rollovers are accepted; other backward jumps/frozen clocks fail.
7. Clock fits use alternating 30s train/held-out blocks. Speed candidates are
   searched within +/-2s of the clock estimate, using separate fit/validation
   windows. Low excitation, inconsistent windows, drift and location mismatch
   fail or downgrade explicitly. Interpolation does not cross >0.5s gaps.
8. The UI shows the time overlap and candidate lap coverage. Review three
   locations on the selected lap and explicitly confirm before replacing its
   calibration. Rejection/uncertainty preserve the prior calibration. Receipts
   stay in localStorage and are not submitted as training labels. Demo cannot
   request server synchronization.

Convention: `video_time_s = telemetry_session_time_s + offset_ms / 1000`.
The current player applies a constant offset only; substantial measured drift
requires manual anchors and is not silently corrected.

## Evidence Limits

- GPSU is anchored to a metadata packet; sensor/packet/frame latency is not
  calibrated. Per-sample times within a packet are uniformly reconstructed from
  its MP4 CTS, duration and timescale, **not native hardware timestamps**.
- AiM time-validity flags are not exposed here. `TimTpItow` can be held over
  several recorded samples. Quantization is reported, not hidden by interpolation.
- GPS5 summaries use within-payload ~0.2s boxcar averaging with center timestamps.
  This is a coarse synchronization signal, not raw data for vehicle dynamics.
- Position residuals compare unregistered GPS coordinates; different receiver
  errors can affect them. Agreement is not independent frame-level ground truth.
- Speed correlation, clock-fit residuals and search resolution are not success
  probabilities or claimed timing accuracy. Human checks remain required even
  when all gates pass. Lap coverage describes recording time coverage, not an
  independent proof of lap identity or uninterrupted valid sensor data.
- Camera ACCL/GYRO axes remain uncalibrated. Reported rates are sample count over
  payload time, not hardware bandwidth or validated roll/pitch/steering signals.
- Edited/fragmented MP4 timelines, multiple gpmd tracks and GPS9 are not supported
  for synchronization yet. Metadata-stripped videos use audio/manual fallback.
  Metadata inspection can work even when video playback is unavailable; visual
  confirmation stays disabled until the original can actually play.
- Limits: 20 GiB original, 1 hour, 3,600 metadata packets, 32 MiB header reads,
  32 MiB metadata, 1 MiB/packet, 120s local read budget. Server payloads accept up
  to 3,600 clock and 20,000 GPS summary points. Cancellation is cooperative between
  packet reads/parser calls and cancels fetch; no original is persisted by this API.

## Parsers And Licenses

- [MP4Box.js](https://github.com/gpac/mp4box.js), pinned `mp4box@0.5.2`, BSD-3-Clause:
  MP4 sample tables and track timebases, not a hand-written binary scanner.
- [gopro-telemetry](https://github.com/JuanIrache/gopro-telemetry), pinned `1.2.11`:
  genuine KLV numeric parsing in `raw: true` mode. The distributed LICENSE is MIT
  (package metadata labels it ISC); preserve the actual upstream LICENSE.
- [GoPro GPMF format](https://github.com/gopro/gpmf-parser) documents GPS5/GPSU and
  packet timing. No default interpreted-date fallback or camera matrix is used.

Both parsers load lazily in the browser. The same extraction function is used by
the private local audit command, so local and browser clocks follow one method.
Distributed notices, including the binary-parser dependency, are preserved in
`public/licenses/gopro-metadata.txt`.

## Private Validation

Run from the repository root with Node 22.13+ and the project's Python environment:

```bash
node --experimental-strip-types scripts/audit_gopro.mjs \
  --file /path/to/private/GHxxxxxx.MP4 --output tmp/gpmf-audit/camera.json
XRK_TEST_FILE_PATH=/path/to/private/session.xrk \
  python scripts/audit_gnss_sync.py --camera tmp/gpmf-audit/camera.json \
  --output tmp/gpmf-audit/pair
pnpm run test:gnss-sync
python -m pytest backend/tests/test_gnss_sync.py -q
```

`summary.json` and `report.md` contain candidate evidence and limitations, not
training truth. Output is restricted to ignored `tmp/`; source video/XRK remain
unchanged. Do not publish these private artifacts. Do not use private files in a
public smoke test. After the full release checks, deploy Railway first, then the
frontend. Older backends return an unavailable error and audio/manual still work.
