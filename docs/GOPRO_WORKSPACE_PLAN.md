# GoPro Evidence Workspace

Updated: 2026-10-16. Incremental work in the main application, not a second
public product. `trial-app/` remains a private research reference.

## Objective

Use recorded GoPro metadata to help locate the matching real AiM lap, review
the alignment, and drive video/telemetry together. Preserve CSV, XRK, manual
anchors, existing quality gates and conservative coaching. Never synthesize
lap performance or treat camera axes as calibrated vehicle axes.

## Baseline Before This Increment (code inspected)

- Browser-local MP4Box/GPMF extraction already exists, with bounded sparse
  reads, cancellation, edit-list rejection and no video upload.
- GNSS clock/speed checks already expose limitations and require three manual
  review points. Camera IMU is counted but not used as vehicle telemetry.
- Main-project track references already use finite directed gate intersections
  and quality-gated real laps. Do not replace them with the trial's nearest
  gate-center sample timestamps or relaxed lap filtering.
- Single-lap playback still uses `timeupdate`. Spatial synchronization does
  not yet fit/validate a frozen translation on separate data.

## Delivery Checklist

### A. Metadata and playback

- [x] Preserve declared units, SCAL, ORIN/ORIO, MTRX and timing metadata in the
  local audit. Missing or changing orientation remains explicit. No camera
  axis is labelled vehicle yaw/roll/pitch without mounting calibration.
- [x] Drive the existing single-lap cursor from presented video `mediaTime`
  with seek/pause/fallback handling and callback cleanup. Show measured update
  rate, never claim synchronization accuracy from screen refresh rate.
- [x] Keep video and camera IMU local; only the existing bounded GPS summaries
  reach the token-owned API. Preserve cloud filesystem and API-origin guards.

### B. Multi-evidence synchronization

- [x] Add bounded geometry offset/translation fitting with held-out laps or
  disjoint time blocks. Freeze the fitted transform during validation.
- [x] Retain invalid-fix masks and timestamp gaps. Reject insufficient motion,
  poor coverage and excessive shifts. Report per-window residuals and failure
  reasons, not a fabricated probability or frame-level error guarantee.
- [x] Display clock, speed and geometry evidence plus registered/raw GPS
  overlay. Label shared GNSS evidence as correlated, not independent votes.
- [x] Preserve manual confirmation and existing audio alternatives. Evidence
  disagreement cannot silently overwrite a user's calibration.

### C. Track geometry contract

- [x] Add one server-derived arc-length contract from the final reference path:
  per-point s, closing-edge length and closed total. Preserve old v1 configs.
- [x] Use the same contract for map readouts and gate locations. Test closing
  edge/wrap boundaries and true directed intersections, including missing and
  repeated crossings. Keep logger trigger coordinates separate from platform
  timing gates. Never force re-cut lap times to equal logger laps.
- [x] Show existing real-lap phase/repeatability results with sample count,
  mean-CI interpretation and serial-dependence limitations.

### D. Camera sensor research view

- [x] Add an explicitly local experimental channel view with raw sensor-axis
  identity, units and timestamp method. Do not equate packet-interpolated times
  with hardware timestamps or nominal sample rate with hardware bandwidth.
- [x] Any PSD uses a documented uniform-grid/gap policy and absolute physical
  density units. Do not compare unrelated runs or independently peak-normalized
  PSD as sensor performance. Unsupported timing/units must be unavailable.
- [x] No wheel-hop, grip, sideslip, body yaw or mechanical diagnosis. Research
  outputs do not enter coaching/LLM evidence or quality-gate decisions.

### E. Local Acceptance

- [x] Deterministic mock tests: known offsets/translations, held-out mismatch,
  missing fix, gaps, poor excitation, orientation, player lifecycle, arc length.
- [x] Private real-file audit via environment/CLI paths under ignored `tmp/`;
  never commit/upload private telemetry, GPS routes, media or filenames.
- [x] Desktop/mobile browser verification: choose video, inspect metadata,
  inspect evidence, preview three locations, confirm/reject, play/seek, replace
  file and verify stale results/callbacks are discarded. Human visual agreement
  is separate from automated UI verification.
- [x] Backend tests (including configured private samples), frontend tests,
  GNSS/RPM tests, rendered routes, lint, Sites/Vercel builds and API-proxy tests
  and build passed. Existing public pilot smoke passed; this is not a release
  of the new code. Detailed counts are in the acceptance report below.
- [ ] Container configuration/build smoke: Docker is not installed locally.

### F. Follow-Up Release

- [ ] Publish the locally accepted increment: backend before frontend; retain
  existing rollback versions. No deployment or GitHub push was performed by
  this local implementation task. Public smoke tests must use reviewed demo
  data, not private original recordings.
- [ ] Human visual confirmation of start/middle/end for each real pairing.
  Automated checkbox/playback tests do not provide that confirmation.

Local implementation and browser acceptance are complete. Container validation,
publication and human synchronization truth remain separately tracked, not
silently promoted to passed. See [Acceptance](GOPRO_WORKSPACE_ACCEPTANCE.md).

## User Workflow

Import XRK -> choose actual lap -> select original GoPro video -> inspect local
metadata -> compare sync evidence -> preview start/middle/end -> confirm or keep
manual anchors -> inspect synchronized map/curves/video. Missing metadata or
failed checks leave audio/manual workflows available.

## Non-Goals

No new ML training, accounts, storage service, automatic pedal diagnosis,
synthetic reference laps or extrapolation through missing telemetry. Actual
camera-to-frame latency and vehicle-axis calibration still need independent
measurements. A smaller residual after registration is not proof of better GPS
accuracy or that two trajectories were driven identically.
