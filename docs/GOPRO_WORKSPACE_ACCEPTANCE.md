# GoPro Workspace Acceptance

Date: 2026-10-16. This report records local acceptance before publication;
deployment history is authoritative for the currently served release.

## Delivered

- Existing Single Lap Analysis now exposes GoPro channel provenance, clock,
  speed and held-out trajectory evidence, plus a raw/registered GPS overlay.
- Geometry fitting and validation use different complete logger laps when
  possible, otherwise disjoint time blocks. Translation and offset are frozen
  before validation. Missing fixes and large gaps are not interpolated through.
- Video cursor updates use presented-frame timestamps when supported, with
  seek/pause handling, cleanup and a `timeupdate` fallback. Update frequency is
  displayed as an observed UI rate, not synchronization accuracy.
- Track-reference v1 gains one closed-path distance contract derived from the
  final path. Legacy maps remain accepted; contradictory distances are rejected.
- A browser-local experimental view plots scaled ACCL/GYRO columns and a
  documented Welch PSD. Camera axes are not relabelled vehicle axes. These
  results never enter coaching, LLM evidence or lap-quality decisions.
- Existing manual/audio synchronization, CSV, XRK, quality gates and conservative
  repeatability displays remain intact. No dependency was added.

## Automated Checks

| Check | Observed result |
| --- | --- |
| Backend, without private sample configuration | 258 passed, 1 skipped |
| Backend, with private data directory configured | 266 passed, no skips |
| Frontend suite | 138 passed |
| GNSS / frame-clock / camera-spectrum suite | 20 passed |
| RPM synchronization suite | 27 passed |
| Rendered HTML routes | 11 passed |
| API proxy suite | 6 passed |
| Lint | Passed |
| Sites build and public-bundle guard | Passed |
| Vercel build, scoped TypeScript and public-bundle guard | Passed |
| API proxy build | Passed |
| Existing public pilot health/capabilities/runtime checks | Passed; old release |
| Local Docker configuration/build | Not run: Docker unavailable |

Suites overlap; counts must not be added as a unique-test total. Backend emitted
one existing Starlette/httpx deprecation warning. Webpack local preview also
warns about the parser's optional `egm96-universal` dependency; extraction uses
raw mode, and no altitude/geoid correction is claimed. Production builds pass.

## Private Real-File Checks

All raw files and detailed artifacts remained local under ignored `tmp/`.
No private recording, native channel array, route, identity or full audit was
added to the repository or sent to the public service.

- One original GoPro chapter yielded 80,703 samples per IMU channel, about
  199.07 Hz, and 7,310 GPS samples, about 18.03 Hz. Parsing used sparse metadata
  reads rather than decoding or uploading the video.
- The paired audit produced a clock candidate of +23.799 s and a geometry
  candidate of +23.749 s under `video_time = session_time + offset`.
- Held-out geometry median/p95 residuals were 1.976/11.932 m. The fit passed
  its exploratory geometry checks, but held-out speed deviation reached
  0.350 s. The combined result correctly remained **weak / unconfirmed**.
- These are computed candidates, not a verdict that clock/geometry is more
  accurate than audio. GPS checks share receiver information; registration can
  absorb bias, and sensor-to-frame latency is uncalibrated.
- Track audits processed eight private sessions. Existing quality filtering
  accepted 77 of 90 logger-valid laps for registration. Among accepted laps,
  1,848/1,848 directed gate checks found exactly one crossing. The pipeline
  formed 58 complete platform laps and 696/696 usable corner intervals.
  These denominators exclude rejected/incomplete data and do not establish
  manually verified corner labels or all-session universality.

## Browser Acceptance

Installed Chrome, desktop 1440 px and mobile 390 px, against local frontend and
local cloud-mode API:

- Real XRK import and original video playback succeeded.
- Metadata, geometry overlay, local IMU/PSD and bilingual labels rendered.
- Three-point preview and confirmation flow succeeded. Those temporary UI-test
  receipts were not driving labels or human visual validation.
- Rechecking and rejecting preserved the previous calibration exactly.
- Replacing the video removed the old GPS result; the new player resumed
  frame-driven updates. Clock callback cleanup also has deterministic tests.
- Manually marking a real logger lap's start/end saved a constant-offset binding
  and its duration residual. A deterministic mocked visual-proxy response of
  0.39 left that stored calibration unchanged and was not displayed as accuracy.
- Observed playback updates were 59-60 Hz. No page exception occurred; mobile
  document width remained 390 px without horizontal overflow.
- Test inspection tokens were deleted after the browser run. No private data
  was posted to a public origin.

## How to Use

1. Import the real XRK and select the intended actual lap in Single Lap Analysis.
2. Select the original GoPro chapter, retaining its embedded metadata.
3. Choose **Check GPS timing**. Review clock/speed/geometry and their warnings.
4. Preview near lap start, middle and end. Confirm only when both visible
   location and lap identity agree; otherwise choose Mismatch/Uncertain and
   retain or adjust manual anchors.
5. Expand **Camera channels and spectrum - Experimental** to inspect local
   camera columns. Use a continuous 6-60 second interval; unavailable results
   explain timing, coverage or unit limits.

## Remaining Boundaries

- Release the compatible Railway backend first, then Vercel/Sites; validate the
  newly deployed versions. The local tests above do not establish public status.
- Docker smoke, human visual pairing accuracy and camera/body-axis calibration
  remain unverified. No automatic drift correction was added.
- Uniform timestamps inside metadata payloads are estimates, not hardware
  per-sample timing. PSD is exploratory, not a hardware bandwidth measurement.
- No new grip, wheel-hop, sideslip, braking-force or mechanical conclusions.
- Existing short-sample repeatability limitations and manual review requirements
  remain in force. A successful rendered page does not prove physical accuracy.
