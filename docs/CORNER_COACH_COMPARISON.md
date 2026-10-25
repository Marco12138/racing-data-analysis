# Corner Coach Comparison

The selected-corner review panel compares the fastest
observed section with the same section of the fastest eligible complete lap.
It does not replace Lap Quality Gate, automatic visual matching, manual anchors,
GPS anomaly notices, or the existing exploratory groups.

## Selection and Alignment

- Rank real complete laps by recorder lap time among existing analysis-eligible
  laps. If that fastest lap lacks a usable section, show unavailable rather than
  relabeling a slower full lap.
- Rank sections by elapsed time between the same directed entry and exit gates.
  Exclude flagged GPS intervals and manually rejected video matches. Unconfirmed
  videos remain candidates, not verified synchronization.
- If both winners are the same lap, say so. Exact numerical ties are listed;
  this is not a sensor-noise threshold or significance test.
- Freeze intermediate gates about every five metres on the selected real path,
  plus distance thirds. Use the existing translation registration and unchanged
  finite-gate crossing constraints. Every intermediate gate must be crossed once
  in increasing time order within the accepted section.
- Interpolate observed speed and optional RPM at each lap's own crossing times.
  Retain legal zero values. Missing RPM remains null; missing or ambiguous
  checkpoints make the overlay unavailable, without invalidating legacy review.
- The horizontal coordinate is position along the selected reference path,
  not each lap's distance stretched to 100 percent. Existing normalized-distance
  clustering profiles are separate and are never used for this overlay.

## Reading the Result

The cumulative gain at a shared checkpoint is
`full_lap_best_elapsed - section_best_elapsed`; positive favours the section
winner. Its final value equals the observed section-time difference. Speed-curve
area is not used to calculate a time gain. Distance thirds locate where to
review; they are not labelled as confirmed brake/apex/throttle phases.

The existing downstream gate is about 50 metres beyond the exit on the selected
real path. Combined time is reported only when both laps have continuous usable
data through that same gate. Local gains may be lost downstream.
GPS warnings are checked over the downstream interval as well, retaining the
manual half-second uncertainty margins. A downstream-only warning withholds the
combined gain, while the usable main-section comparison remains visible.

The review button selects those two real videos and seeks each to its own gate
time using existing per-lap manual anchors, or the existing propagated anchor.
It never writes an anchor, changes the original selection lap, time-warps video,
or converts a visual match into a confirmed driver action. The original selected
lap remains available through the return control.

## Boundaries

These are descriptive observations, not a guaranteed best technique, causal
model, statistical significance result, or proof of greater recognition accuracy.
GPS registration and gate positions remain inferred. Manual video uncertainty
remains +/-0.5 seconds. A partial braking-to-exit interval remains partial.
RPM decline is not brake pressure, and higher RPM alone does not establish a
better exit. Visible posture and driving actions still need review.

## Recommended Review and Debrief

The recommended-review step reuses the same spatial-gate comparison and players.
For each existing recommendation, a confirmed, matching local-video anchor locates
a five-second seed around that zone's minimum-speed focus on that anchor's real
lap. The existing bounded context detector then adds approach and recovery.
The seed never changes a saved anchor or its +/-0.5-second uncertainty. A missing
trace, unconfirmed anchor or uncovered video leaves the comparison unavailable.
Original target-lap review and feedback remain in an expandable section.

The default pair is the section winner and fastest eligible complete lap. When
both are the same lap, show that real winner against another candidate and label
the second lap as a comparator, not a second winner. Drivers can still browse
all candidates and check boundary frames. Videos keep their own timing, audio
selection and per-lap speed/RPM charts.

Recommendation text, the final guided debrief and its Markdown download use one
deterministic observation builder. They state the largest distance-third gain,
the separate downstream delta, and whether the gain remains. Partial context,
unconfirmed video, missing downstream timing and GPS warnings stay explicit.
The new gate-based deltas do not replace or add to legacy consensus scores.
No model infers pedal causes from RPM, and no local gains are summed into a
theoretical target lap. A changed inspection, video or manual calibration
invalidates cached review evidence; updated GPS diagnostics re-evaluate it.

```bash
pnpm run test:guided-review
```

## Validation

```bash
python -m pytest backend/tests/test_selected_corner.py -q
pnpm run test:selected-corner
```

Coverage includes known circular trajectories at different sample rates,
analytical crossing-time fractions, shared positions, missing/non-unique gates,
monotonic order, missing RPM, legal zeros, preserved inputs, winner ties, quality
exclusions, GPS warnings, manual rejections, downstream reversal, and bilingual
rendering. Private real-file audits and screenshots stay under ignored `tmp/`.
