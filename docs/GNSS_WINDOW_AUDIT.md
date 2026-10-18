# Failed GNSS speed-window audit

## What is fixed

A local maximum of speed correlation is not a direct clock measurement. A
receiver speed transient can move that maximum even when the recording clocks
are continuous. Previously the UI reported the resulting offset difference
without the signals needed to distinguish these cases.

The failed window now remains visible with:

- The exact telemetry and candidate video ranges.
- AiM GPS speed and GoPro GPS speed at the fit offset and the local best shift.
- Common-sample RMS and maximum speed difference, including the peak's values.
- Untranslated GPS position difference and camera UTC-minus-payload clock span.
- Spacing, duplicate and reversal counts for the input series used in the check.

The diagnostic does not change the estimator, its fit/validation split or its
existing **0.25 s / 0.8 correlation** gates. It does not remove samples/windows,
apply the local shift, overwrite a manual anchor or promote weak results.
The local best shift is fitted on this very window: its remaining error is
descriptive and must not be presented as held-out validation.

Input spacing describes the available data, not clock hardware. GoPro summary
positions are averaged within payloads. Unaveraged GPS5 timestamps below are
still uniformly assigned within each payload, not per-sample hardware stamps.
Neither receiver is independent position/speed truth. Bad agreement cannot
identify multipath, obstruction, hardware failure or video delay by itself.

## Reproduce privately

Use the original MP4 and XRK, not a transcoded video or exported timing table.
Set `GOPRO_TEST_FILE_PATH` and `XRK_TEST_FILE_PATH` to local files. Do not commit
the files, generated reports, GPS points or browser screenshots.

```bash
node --experimental-strip-types scripts/audit_gopro.mjs \
  --file "$GOPRO_TEST_FILE_PATH" --output tmp/gnss-window/camera.json
node --experimental-strip-types scripts/audit_gopro_packets.mjs \
  --file "$GOPRO_TEST_FILE_PATH" --output tmp/gnss-window/packets.json
python scripts/audit_gnss_sync.py \
  --camera tmp/gnss-window/camera.json \
  --camera-native tmp/gnss-window/packets.json \
  --file "$XRK_TEST_FILE_PATH" --output tmp/gnss-window/result
```

The first extraction follows the browser's production summary path. The second
reads original GPS5 packets without the boxcar averaging and retains GPSU,
GPSF, GPSP, sample counts and packet timing. The final script freshly parses the
XRK native cache, reruns both checks and writes local `summary.json`/`report.md`.
All output paths are restricted to ignored `tmp/`. There is no network upload.

GPSF=3 only indicates a 3D fix, not error-free measurements. GPSP is DOP x100,
not an error bound in metres. These definitions and the distinction between
payload timing and telemetry samples follow the
[GoPro GPMF documentation](https://github.com/gopro/gpmf-parser#hero5-black-with-gps-enabled-adds).

## Acceptance

- Existing successful fixtures retain their prior offsets/status.
- A genuine local time shift remains a failed held-out window.
- A speed-shape fault with unchanged clocks stays weak, with its residual shown.
- Missing data remains null; no extrapolation or filling long gaps.
- Legacy responses without the diagnostic still render.
- Both languages retain manual confirmation and explain that offset spread is
  not measured video delay. Private original-file checks stay local; public
  smoke testing uses only approved demo data or numerical test fixtures.
