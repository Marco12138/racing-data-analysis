# Observed Track Reference v1

This is an opt-in geometry workspace, not a new performance benchmark. It does
not change Lap Quality Gate, Top 3 selection, logger timing, or coaching rules.
It creates no composite lap, RPM curve, or promised improvement.

## Workflow

1. Import a real XRK and open **Track Map > Fixed track reference**.
2. Create from the selected real quality-eligible reference lap, or import a
   previously exported track JSON. Keep that same config when comparing sessions.
3. Match the current session. Inspect original GPS and the translated overlay,
   held-out residuals, rejected laps, gate counts and platform timing separately.
4. Review the actual timing line in synchronized video. Place its finite gate
   on the map and confirm it only after that check.
5. Review the candidate corner names and grouping with a coach. Edit entry/exit
   gates; remove redundant candidates and extend the retained interval to merge
   a combination. IDs stay stable when the timing line or display name changes.
6. Save to the browser or export JSON. Editing any gate/name invalidates previous
   results. Rematch before using the revised result. Restore the saved config
   after changing session or refreshing the page. This prototype keeps one active
   saved map per browser; exported JSONs can retain other tracks/revisions.

Changing gates in this workspace does not automatically synchronize video or
publish a track. A checked confirmation is a user's declaration, not independently
verified survey data, driving truth, or a training label.

## Geometry And Evidence

- One real lap supplies the reference polyline, source fingerprint, lap number,
  local projection origin and winding. Curvature peaks are **candidates**, not
  official corner numbers. Finite directed gates must be ordered, non-overlapping,
  perpendicular to travel and outside the timing-line seam.
- Read native GPS timestamps/values from the inspection cache, not a downsampled
  Dashboard response. Select the importer's chosen channels, verify degree units,
  keep zero speed, and document auxiliary sampling and units. Removing invalid
  GPS samples does not modify the original native cache.
- Fit only a bounded translation per logger lap. No scaling, rotation, elastic
  warp, or snapping of measured lines to the reference path. The original line
  remains available, including rejected laps.
- Use equal-distance samples and alternating 20m spatial blocks for internal
  fitting/holdout. Default acceptance: holdout median <1m, P95 <2.5m,
  translation <=20m, between-fold translation difference <3m, length difference
  <=3%. These are provisional engineering gates, not calibrated probabilities
  or sensor-accuracy specifications. A good fit cannot separate GPS bias from
  driving-line changes, and the holdout is not independent ground truth.
- Existing reference-eligible and context-only complete laps may be considered
  for geometry. Context-only laps are **not** promoted into Top 3. Incomplete,
  discontinuous, reverse-direction, poor-fit or mismatched laps are rejected.
- Gate timestamps use line-segment intersections and interpolation only within
  observed short brackets. Return those brackets and their sampling interval.
  Never connect the translated end of one logger lap to a differently translated
  start of the next: gate events retain half-open logger-interval ownership.
  A seam can consequently miss/double a passage; this remains a visible failure.
  Every proposed platform interval must also travel approximately one reference
  circuit in the **untranslated** GPS data. Short duplicate passages or two-lap
  intervals caused by translation seams are unavailable, never new fast laps.

## Timing Boundary

Moving the timing line does **not** preserve each lap's duration. With logger
starts `s_i` and passage offsets `o_i`, platform interval duration is:

```text
(s_(i+1) - s_i) + (o_(i+1) - o_i)
```

The offsets may change between laps. Equality to logger lap times within one
sample is therefore not a valid acceptance criterion. The returned partition
identity is only arithmetic consistency. It is not an independent 0.05s accuracy
test. Logger numbers and durations remain unchanged; platform laps include their
actual source logger laps and are not substituted into rankings.

## Bounded Corner Phases

Windows start at the previous corner's exit gate and stop at the current corner's
exit. No blind 30m extension is used in this sidecar. Missing/ambiguous gates,
invalid speed provenance, long gaps, stationary points and unavailable thresholds
produce explicit unavailable results.

Use actual GPS speed, locally smoothed XY curvature and real timestamps.
Short-bracket boundary interpolation is recorded. Freeze one zone calibration
from common median profiles across available platform laps, then apply the same
thresholds to each lap. Calibration profiles are internal detector parameters,
not a synthetic driving reference.

The five events are deceleration onset, curvature build-up, minimum speed,
acceleration onset and corner exit. Their existence is not guaranteed: a narrow
curvature candidate can end before recovery/exit. Missing phases are not filled.
All are provisional kinematic inferences, not confirmed brake, throttle or
steering actions. No physical IMU axes are consumed.

## API And Retention

```text
POST /api/v1/tracks/reference
{inspection_id, lap, track_id, venue_aliases: []}

POST /api/v1/tracks/match
{inspection_id, track_config}
```

The first returns a versioned config; the second returns quality-gated per-lap
registration, original/registered traces, timestamped gate crossings, platform
intervals, bounded phases, processing provenance and coverage denominators.

Only existing live inspection tokens are accepted. Host paths are not inputs.
The original XRK is still deleted after parsing; native/normalized caches retain
their existing fixed expiry. Track configs are client-owned, not server-persisted.
Limits: 200 timed laps, 500,000 GPS samples, 5,000 reference vertices, 30 corners,
and two concurrent track computations per process. A cancelled browser request
does not pretend to kill the running CPU thread; its slot remains held until
completion. Expired caches return 410, insufficient data/config 422, saturation
429. APP_MODE and API-origin validation are unchanged.

## Private Reproducible Audit

Use a local Python environment with `requirements.txt` and `requirements-xrk.txt`.
Never add private logs, coordinates, output JSON, screenshots or driver names to
public fixtures. Outputs below are git-ignored.

```bash
export XRK_TEST_FILE_PATH="/private/reference.xrk"
export XRK_TEST_DATA_DIR="/private/xrk-directory"
python scripts/audit_track_reference.py --lap 13 --plot
# Add independent sessions without changing thresholds:
python scripts/audit_track_reference.py --lap 13 \
  --data-dir "$XRK_TEST_DATA_DIR" --data-dir "/Volumes/private-sessions" \
  --output tmp/track_reference_audit/all --plot
# Audit a human-edited configuration:
python scripts/audit_track_reference.py --config "/private/track_config.json" \
  --data-dir "$XRK_TEST_DATA_DIR" --output tmp/track_reference_audit/revised
python -m pytest backend/tests -q
pnpm run test:frontend
```

The script excludes hidden/macOS fork files, prefers XRK over sibling XRZ and
deduplicates identical hashes. Each file retains importer exclusions, native lap
segment count, registration reasons, gate denominators, phase coverage, before/
after hash equality checks and detailed results. Temporary extraction is cleaned on completion
or error. `summary.json`, `report.md`, config and optional PNGs stay local.

Do not turn conditional gate coverage into an all-session accuracy claim. Publish
the failed cases, incomplete windows and manual-review status alongside successes.

## Required Human Review

The Chinese operator checklist is [Manual Track Review](MANUAL_TRACK_REVIEW.md).
Completed review forms and actual track configurations must stay private.

- Confirm the physical timing line and direction using the video, not venue name.
- Name/merge the candidate bends; choose entry/exit gates outside neighbouring
  bends. Check that each relevant gate is crossed exactly once.
- Inspect rejected laps and the original, untranslated GPS before deciding whether
  there is a layout difference, GPS anomaly or genuine driving-line difference.
- Compare visible events against returned session timestamps. Record uncertainty;
  do not call a checkbox or internal holdout independent validation.

Only after this should stable corner IDs feed cross-session clustering, coaching
labels, video naming and controlled setup experiments. Multi-evidence automatic
synchronization and learned steering models are not part of this increment.
