# Selected Corner Review

## Driver Workflow

In AI Coach Summary open **Choose a corner / 自选弯道**. Select a lap with an
existing confirmed anchor for the current local video, pause at the desired
entry and mark the current frame. A five-second source interval defines two
provisional physical GPS gates. Keep half a second clear of the lap boundaries.

**Find this corner in every lap** lists all timed laps, candidate clips and
exclusion reasons. The original Lap Quality Gate is unchanged. Low-quality laps
are listed but not used as patterns or references. Candidate clips use the
source anchor plus actual logger session timestamps; this is not confirmation
of the other laps. Video stays in the browser.

Select a lap with the comparison-lap menu or previous/next arrows above the
videos. Every playable candidate remains available, not only a group's
representative. Switching laps pauses playback and retains individual verdicts.
Full-common-interval playback is the default and ends at each lap's crossing of
the same exit gate; disable it for five-second previews. These lengths can differ.
Neither speed nor video playback is stretched.
The GoPro speed HUD uses each presented frame's local camera timestamps.

Each video has its own AiM speed and RPM charts, entry/minimum/exit speed and
minimum RPM below it. Both channels remain visible with shared axis scales.
The x-axis is actual elapsed time, not the distance-normalized clustering
profile. Frame-linked readings and cursors use that lap's video window only
after confirmation; unconfirmed candidates still show their recorded curves
and metrics. GPS warnings and manual-anchor +/-0.5s uncertainty remain visible.
Old responses without time-series samples ask the user to find candidates again.

Run **Check boundary landmarks (all)**. The existing two-background NCC matcher
searches independently within +/-0.5s of each proposed entry and exit. Its .72
similarity and .06 ambiguity gates are unchanged. These are appearance proposals,
not probabilities or object recognition. Weak/ambiguous matches remain visible;
inspect proposed frames without applying them to any anchor. Independently check
both boundaries, then choose Confirm / Wrong corner / Uncertain for each lap.
Feedback is local to the current selection, not a training label stored online.

**Compare confirmed driving patterns** only uses individually confirmed,
quality-gated candidates. Known GPS disagreement intervals remain reviewable but
are excluded from grouping. At least four usable confirmed laps are required.
Changing the source, file, anchor or interval clears old confirmations. Changing
a verdict invalidates the old grouping until recalculation.

## Backend Contract

`POST /api/v1/xrk/selected-corner` accepts an existing opaque `inspection_id`,
`source_lap`, `start_session_s`, `end_session_s` and `confirmed_laps`. No file
path, video, image, credentials or telemetry arrays are accepted. The source
interval must be five seconds. Inspection expiry remains fixed at the existing
deadline; this request creates no stored files or new database records.

The additive route loads normalized telemetry, reuses GPS cleaning and the
unchanged quality gate, and reuses bounded translation-only registration with
alternating 20m spatial holdouts. Median/p95 limits remain 1m/2.5m. Finite directed
entry/exit gates must each be crossed exactly once. No rotation, elastic path
warping or lap-time scaling is applied. Time interpolation requires gaps <=0.5s;
missing speed/position invalidates a candidate instead of fabricating values.
RPM absence only removes RPM from grouping. Registration is not sensor calibration.

Each candidate has its own real crossing times, speed/RPM profile, metrics,
quality result and registration evidence. Additive `telemetry` samples contain
`session_time_s`, `elapsed_s`, `speed` (km/h) and nullable `rpm`. Interior samples
retain normalized channel timestamps/values; only the two crossing boundaries
are interpolated with the existing bounded method. Missing RPM stays null and
zero remains a valid value. These samples are separate from the 41-point
distance-domain profile used for grouping. `elapsed_s` is time between the same
spatial gates, **not** the five-second video preview length. Optional downstream
timing uses a further gate 50m along the source path and remains null without
continuous coverage. At most 60 timed laps are processed; extra laps are listed
as excluded. Source selection spanning the timing line is not supported yet.

## Exploratory Grouping

SciPy Ward hierarchical clustering uses 41-point **normalized within-section
distance** profiles of measured speed and, when complete in all included laps,
RPM. Each channel is scaled by session standard deviation with numerical floors
of 1 km/h / 100 rpm. These floors are not sensor noise estimates. Elapsed time,
lap number, outcome ranking and downstream time do not determine clusters.

Candidate partitions contain 2-3 groups, each with at least two laps. A silhouette
below .35 or negligible profile separation yields one group, not forced styles.
This threshold is an exploratory algorithm setting, not validated accuracy.
The representative is an actual medoid lap, never an average/synthetic curve.
The UI compares group counts, observed median/range of section times, minimum
and exit speed, and downstream times. Ties stay ties. Small samples remain low
confidence: no significance test, noise-floor conclusion, causal attribution or
guaranteed improvement. Groups describe only the reviewed subset of this session,
not the driver's lifetime style or all recorded laps.

Visual similarity does not measure a racing line, steering or pedals. Suggested
next actions are coach-review questions about measured deceleration/recovery
and exit outcomes; no confirmed braking/throttle claim is introduced. Manual
anchors and their +/-0.5s uncertainty are preserved. Selection/confirmation is
currently in-memory; refresh requires selecting the interval again.

## Verification

Run `python -m pytest backend/tests -q` and `pnpm run test:selected-corner` plus
all deployment release checks. Synthetic circles/profile families are test-only.
Local acceptance uses private 0514/GH010681 without uploading them publicly.
Check missing video/anchor, expired inspection, rejected GPS registration,
missing channels, gap/boundary rejection, cancellation, ambiguous visual matches,
no forced grouping, anchor immutability, bilingual and mobile playback.

Deploy the backward-compatible Railway route before Vercel/Sites. Older backends
produce a readable service error, not simulated results. No new dependency is
introduced: SciPy, existing frame extraction and the existing matcher are reused.
