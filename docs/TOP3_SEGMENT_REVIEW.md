# Real Top 3 Segment Review

## User Flow

1. Import an XRK and optionally select the original local video.
2. Open AI Coach Summary. The segment summary lists each real Top 3 lap's split,
   the shortest split (including ties), and pairwise gains through the next sector.
3. Choose a real pair with **Review Lx / Ly**. Use the four-second preview or
   the full sector and next-sector context. Each side requires its own confirmed
   lap/video mapping; otherwise use Add / Adjust clip to save an unlinked preview.
4. Confirm the lap and a visible timing anchor before accepting telemetry-linked
   playback. A manual crop alone does not establish synchronization.
5. Use a fixed trackside landmark to explain the location in ordinary language.
   Visual template matches are only candidates for human review, not position fixes.

GPS distance and confirmed timing determine location. Landmarks explain it.
Two videos play at their original rates, not with DTW or time stretching.
The four-second preview is centered near the selected lap's minimum speed within
the sector; it does not establish that this is where the time loss originated.

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
