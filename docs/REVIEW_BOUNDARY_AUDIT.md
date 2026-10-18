# Private Review Boundary Audit

This offline experiment checks clips inferred from one user-picked lap start.
It does not change production synchronization, thresholds, feedback or anchors.
The original video remains local. All generated evidence must stay under ignored
`tmp/`; do not commit screenshots, telemetry or private reports.

## Run

Use the original private files and the actual user-supplied lap start. The
uncertainty is a user estimate, not a statistical confidence interval or a
reason to relax a synchronization acceptance gate.

```bash
python scripts/audit_review_boundaries.py \
  --file "$XRK_TEST_FILE_PATH" --video "$REVIEW_TEST_VIDEO_PATH" \
  --anchor-lap 4 --anchor-video-start "$MANUAL_LAP_START_S" \
  --anchor-status user_confirmed --anchor-uncertainty-s 0.5 \
  --target-laps 5 6 --output tmp/private-boundary-audit
node scripts/audit_review_frames.mjs tmp/private-boundary-audit
python scripts/render_review_boundary_audit.py tmp/private-boundary-audit
```

Open `report.html` locally and select the same original video. The report creates
a browser object URL, plays at most three clips concurrently, makes no upload or
feedback request and writes no browser storage. The report's play button starts
each real clip at its own start and stops at T+5; it does not stretch time.
An optional local `review-notes.json` can add an explicitly attributed review
checklist; it cannot update synchronization or classify evidence as coach truth.

## Evidence Boundaries

- XRK is reparsed, then the raw source is closed without alteration. Temporary
  importer artifacts are deleted. Private analysis JSON and sampled video frames
  are retained only in the requested local audit folder.
- The logger's actual lap start timestamps propagate the human anchor. Sector
  previews select one source-lap start distance and use bounded interpolation to
  locate that same distance in each real target lap. Missing spans are rejected.
- All previews last five seconds. The endpoint's distance difference is reported;
  five seconds of different driving need not end at exactly the same position.
- Two fixed background crops reuse the existing website matcher unchanged:
  threshold 0.72 and ambiguity margin 0.06. Up to 25 frames within +/-2 seconds
  are checked, plus noncorresponding times as descriptive controls. This does
  not train a model, recognize semantic objects or establish independent truth.
- Similarity peaks are suggestions, never automatic corrections. Broad scenes,
  repeated scenery, blur and driver occlusion can yield high but ambiguous scores.
- `--gps-warning-window START END` takes telemetry session seconds and marks
  overlap with the exact previously failed window. Visual similarity cannot
  clear that GPS failure. `--extra-start-distance` adds targeted local probes.
- Frame times report actual frame indices. Human pick uncertainty, temporal
  search grid resolution, source sampling and true synchronization accuracy are
  distinct quantities; do not report any of them as an accuracy percentage.

The local report remains private audit material. The workspace now reuses this
bounded start-only workflow: one shared distance, a five-second crop, explicit
start confirmation, and read-only background comparison. See DEPLOYMENT.md for
the release checks. No new driving-performance conclusions are derived from
image similarity.
