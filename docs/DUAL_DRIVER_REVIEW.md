# Two-driver review

## Entry points

- `/video-coach`: local video-only repeated-pass search and paired five-second playback.
- `/compare`: two XRK/video pairs through Import, Overview, Pair laps, Review,
  Your corner, and Debrief. `/review` and `/workspace` remain unchanged.

## Video-only repeated passes

Confirm a keyframe on A, then search the recording. When both files have usable
GoPro GPS, a coarse finite directed gate narrows the candidate times first.
Invalid fixes, non-monotonic timestamps, long gaps, and implausible position/speed
steps are excluded, not interpolated. This is a candidate search, not calibrated
cross-camera GNSS alignment; different receivers can retain position bias.
Without paired GPS the local decoder samples at 0.5-second intervals and finds
separated appearance peaks. Each candidate is refined within a bounded window.
Two background regions reuse the existing 0.72
similarity, 0.06 ambiguity, and 0.25-second inter-region agreement checks.
GPS-located candidates with ambiguous appearance remain explicitly pending human
review. Visual-only results must pass the unchanged appearance checks. The final
frame is advisory: different speeds need not reach the same place
after five seconds. No threshold is relaxed to improve coverage.

Candidates are not lap identities, learned driving styles, or guaranteed complete
coverage. Every candidate remains subject to human location review. Previewing a
candidate plays five seconds. Choosing one does not replace the search keyframe
or discard the other candidates. B can use A's keyframe or its own independent
keyframe when the camera views differ. Failed cross-camera matching is not
promoted to a valid match. Limit: recordings up to 30 minutes and 60 candidate
visits. A search can be cancelled; its hidden decoder is disposed.

Video pixels, sound and camera metadata stay in the browser. Search results are
in memory; existing manually saved pair reviews remain in their original store.

## Dual telemetry API

`POST /api/v1/comparisons/review`

```json
{
  "session_a": {"inspection_id": "<temporary token>", "lap": null},
  "session_b": {"inspection_id": "<different temporary token>", "lap": null},
  "source_start_s": null
}
```

Blank laps select each session's fastest quality-gated real lap. An optional
`source_start_s` is an A-side telemetry session timestamp and defines a five-second
source interval. Original inspection expiry, deletion, public errors and cloud
filesystem boundaries apply. No new database or permanent upload storage is used.

- Overview ranks **all eligible rows**, not just the existing Top-3 shortlist.
  Exactly five eligible laps are required for the displayed fastest-five
  population variance (`ddof=0`, units seconds squared). With fewer laps it is
  unavailable. This selected-lap dispersion is not all-session consistency,
  sensor noise, a confidence interval, or an effect-size claim.
- Both real GPS trajectories undergo existing cleaning and translation-only
  registration with held-out spatial blocks and unchanged acceptance gates.
  Different track metadata or incompatible lengths reject comparison; failed
  registration preserves timing but produces no linked corner metrics.
- Shared finite, directed entry/exit gates define a physical interval. Each gate
  must have one valid crossing in B; long gaps, missing coverage, reversal and
  ambiguous crossings are not bridged. Logger start-line distances and zone IDs
  are **not** assumed to coincide between sessions.
- Recommended candidates use A's existing curvature zones and rank the available
  shared-gate elapsed-time differences. At most three are recommended; none are
  filled with invented evidence. Custom selection reuses the same gate logic.
- Playback is t to t+5 at normal speed on each side. Gate-to-gate elapsed time is
  computed separately. B's actual traversal need not last five seconds. Curves
  display each real trajectory's normalized distance between these gates, not
  an index-based time alignment or a synthetic reference lap.

## Manual pairing and conclusions

A and B independently select a real lap and mark the video start/end. The start
sets a constant offset; the end is a residual check, never a time-warp fit.
Manual uncertainty remains +/-0.5 seconds. Bindings use a separate versioned
localStorage namespace scoped to inspection, sampled video identity, and lap;
the existing single-driver anchors are never changed. Expired server tokens
require importing again. Changing files/laps invalidates current review
confirmations; it does not delete the saved anchors.

Debrief includes only paired clips whose shared location was explicitly reviewed.
It separates observed gate time, entry/minimum/exit speed, RPM, and existing
inferred signal events. A transient RPM drop is not confirmed braking; raw camera
accelerometer axes are not steering or calibrated lateral G. Higher mid-corner
RPM cannot establish that it caused a faster exit. Audio is not used as a new
braking detector in this release. Different vehicles/gearing, conditions and
human timing uncertainty remain confounders. No model is trained on these clips,
and UI testing confirmations are not submitted as coach training labels.

## Verification

```bash
python -m pytest backend/tests -q
pnpm run test:dual-driver
pnpm run test:video-comparison
```

Also run all release checks in `DEPLOYMENT.md`. Tests use small mock records for
population variance, different sample rates, independent logger origins, missing
channels, gaps, expired tokens, identity-scoped binding restoration and bounded
video candidates. Private recordings and their audit outputs stay in ignored
`tmp/`; they are not fixtures or public demo media.

Release the backward-compatible backend endpoint before enabling `/compare` on
the public frontend. A local implementation/test is not evidence of a public
deployment or of a confirmed second driver's video/telemetry identity.

Local acceptance used private real recordings without publishing them. Two
distinct XRK sessions passed the unchanged spatial-registration checks and
returned three shared-gate candidates. One had fewer than five eligible laps,
so its fastest-five variance remained unavailable. The six-step browser test
used two laps of one known video/session as a regression fixture, not as proof
of two drivers' identities. Repeated-pass search found seven GPS-located
candidates in the source recording, still subject to human review. The other
camera view did not pass cross-video appearance matching and retained its
independent-keyframe fallback. These results are not a precision/recall study.
