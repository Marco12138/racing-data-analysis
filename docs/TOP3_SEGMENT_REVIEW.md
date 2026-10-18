# Real Top 3 Segment Review

## User Flow

1. Import an XRK and optionally select the original local video.
2. Open AI Coach Summary. The segment summary lists each real Top 3 lap's split,
   the shortest split (including ties), and pairwise gains through the next sector.
3. Choose a real pair with **Review Lx / Ly**. Use the four-second preview or
   the full sector and next-sector context. A side with its own confirmed mapping
   uses it first. Otherwise a confirmed anchor in the **same session and file**
   can propose a preview using the logger's actual session timestamps.
4. Confirm the lap and a visible timing anchor before accepting telemetry-linked
   playback. A manual crop alone does not establish synchronization.
5. Use a fixed trackside landmark to explain the location in ordinary language.
   Visual template matches are only candidates for human review, not position fixes.

GPS distance and confirmed timing determine location. Landmarks explain it.
Two videos play at their original rates, not with DTW or time stretching.
The four-second preview is centered near the selected lap's minimum speed within
the sector; it does not establish that this is where the time loss originated.

## Timing Candidates From One Anchor

`video_time = confirmed_anchor.video_time + (target.session_time - anchor.session_time)`.
This uses real elapsed time, including unequal lap durations and nonconsecutive
lap numbers, not a repeated fastest-lap duration. Logger lap boundaries establish
the lap identity; continuous GPS/distance timestamps locate the review position.
The displayed start-to-start difference is calculated from the logger boundaries.

- Candidates remain **unconfirmed**, even when another method reports weak GPS.
  They do not change GNSS thresholds or overwrite manual calibration/crops.
- The continuous-recording assumption is explicit. Edited, paused or concatenated
  videos need new manual anchors. No clock drift or time stretching is inferred.
- No proposal crosses video bounds, missing timing, a >10m distance gap or a >1s
  time gap. Anchors disagreeing by >0.25s stop cross-lap proposals, not average them.
- Only existing confirmed anchors are sources; proposals never become a chain of
  new anchors. Session history is scoped by the inspection's file fingerprint.
- Preview votes remain disabled until explicit per-clip human confirmation.
  The candidate anchor is prefilled in Add / Adjust but its checkbox is unchecked.
  Confirming a crop saves only that crop, not a global offset for another lap.
- If a learned, confirmed passing landmark exists at this clip's position in the
  source lap, search at most 25 local frames within +/-2s of its predicted time
  (clipped to the preview). The existing 0.72 similarity and 0.06 ambiguity limits
  are unchanged. A similar frame is not position truth or measured synchronization
  error; it never moves the anchor. Without a learned landmark, report unavailable
  visual evidence and retain the timing preview for human review.
- Videos, frames and landmark thumbnails remain in the browser. No new API or
  model training is needed. UI tests of confirmation are not independent truth labels.

## Evidence Contract

The additive `top_lap_segments` analysis field uses only the existing quality gate's
first three eligible laps and the existing calculated sector rows. It never fills
missing slots with rejected laps. No quality, consensus or sector-timing algorithm
was changed. Public demo data was refreshed only from the already approved artifact.

- Split ranking uses recorded millisecond precision and preserves ties.
- Positive `local_gain_s` means the reference lap is faster in this sector.
- `next_sector_delta_s` is target minus reference in the next full sector.
- `net_gain_through_next_s` adds only those two intervals from the **same pair**.
- The last sector has no downstream result: `null`, not a zero-cost claim.
- Missing split coverage does not produce a winner or a replacement number.
- These are GPS-distance virtual sectors, not official physical timing gates.
  Cross-session gate equivalence is not claimed.
- Descriptive rankings are not noise-calibrated significance tests, mechanical
  diagnoses, causal improvements or a stitched target lap.

The compact evidence is available to the template report and optional LLM. Neither
raw video nor telemetry plotting arrays are added to the LLM prompt.

## Offset Diagnostics

`/xrk/video-sync/gnss` retains its existing candidate selection and acceptance limits.
Its additive `offset_diagnostics` reports the sample-median clock estimate, linear
clock intercept, speed-window match and GPS-geometry match. Held-out speed failures
report the worst window and the unchanged residual/correlation limits.

A held, quantized time-of-week channel is not precise UTC at every telemetry sample.
Sample median and regression are different estimators; comparing a prior fixed
constant with either does not establish physical clock drift. GPS clock, speed and
geometry share GNSS receivers and are not independent frame-level ground truth.
Unknown sensor-to-video latency remains explicit. A failed window is not removed
to make validation pass. Existing manual anchors are not automatically overwritten.

## Local Acceptance

Private outputs must remain under ignored `tmp/`. Do not commit or publish them.

```bash
python scripts/audit_top_lap_reviews.py --file "$XRK_TEST_FILE_PATH" --output tmp/top-lap-review-audit
python scripts/audit_gnss_sync.py --camera tmp/camera.json --file "$XRK_TEST_FILE_PATH" --output tmp/gnss-review-audit
# Optional comparison with a previous candidate; never treated as truth:
# add --baseline-offset-s <previous-candidate>
python -m pytest backend/tests -q
pnpm run test:frontend
pnpm run test:coach-debrief
pnpm run test:gnss-sync
pnpm run test:rpm-sync
```

Also run every release check in DEPLOYMENT.md. Verify Chinese and English, desktop
and mobile, real lap selection, both video sides, manual preview without sync,
missing data, no demo voting, and no outbound video uploads. Publish the compatible
Railway API first, then Vercel/Sites. Do not upload private acceptance files to production.
