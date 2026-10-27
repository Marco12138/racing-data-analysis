# Published Guided Demo

`/demo` presents six read-only steps alongside the free-workspace entry. It
reuses previously approved anonymized telemetry and nine five-second video
excerpts. No private XRK, original video, inspection cache or user feedback is
included in this upgrade.

## Evidence and Rebuilding

```bash
python scripts/build_published_coach_demo.py
pnpm run test:published-guide
```

The generator reads only `public/demo/reviewed-real-session.json`. Its output,
`public/demo/coach-evidence.json`, binds to the exact source SHA-256. The loader
rejects mixed versions and unapproved media references.

The production translation-registration, directed spatial-gate and common
checkpoint functions are reused on the already-published distance grid.
The grid is resampled, not native sensor data. Gates are inset into the
existing excerpts so both crossing times have published video coverage.
Elapsed time is measured between these common gates, not assumed to be five
seconds. Per-side speed/RPM uses each clip's published source timestamp;
GoPro GPS speed remains separately labelled. Videos are not time-warped.

Recommendations, the final debrief and the Markdown export use the same
`coachObservation` formatter. It reports the largest distance-third contribution
and the next approximately 50 metres separately. These thirds are not confirmed
braking, apex or throttle phases. Local and downstream gains are not combined
with other corners to construct a theoretical lap.

## Coverage Boundaries

- The original anchor is read-only, with its existing +/-0.5s uncertainty.
- Published GPS-warning candidates stay visible but cannot win the comparison.
- Camera-linked AiM readings are explicitly extrapolated, not newly confirmed.
- Only excerpts are public. Complete braking-to-exit coverage is unavailable.
- Downstream timing is telemetry-only; downstream video validation is absent.
- Candidate browsing covers the three published laps. There is insufficient
  confirmed evidence to validate driving-style clusters.
- Arbitrary landmark searches require a full local video. Two-driver comparison
  requires two real datasets; another lap is never presented as a second driver.
- Playback, step navigation and export write no saved anchors, coach votes or
  training labels. No private file-selection control is present in the demo.

## Release Gate

Run the repository release checks plus `test:published-guide`. Inspect all six
steps in both languages at desktop and mobile sizes. Verify candidate switching,
two independent media clocks, single-source audio, speed/RPM under both videos,
identical recommendation/debrief statements, and visible GPS/coverage warnings.
Do not equate server-rendered markup tests with browser playback acceptance.
Keep the current public deployment until this visual/interactive acceptance is
complete. Share only `https://ai-racing-telemetry-platform.vercel.app/demo`.

### Explicit release exception, 2026-10-27

The owner authorized this frontend release after automated tests and local
real-file verification, with browser interaction acceptance explicitly pending.
The browser permission gate prevented the full six-step playback check; it was
not bypassed. Server-rendered tests, media decoding and HTTP resource checks do
not establish audible browser playback, seek behavior or frame synchronization.

Keep production deployment `dpl_Fh6twBWbe6BUfDWuioN4kohsckQA` (main commit
`d1896bed1891223fa3eae047f83220b1320f1758`) as the rollback target. Stage and verify
the new production artifact before promoting the fixed domain. Recheck all
existing application routes and API configuration after promotion. Browser
acceptance remains an open follow-up, not a passed release check.

Private-file audit outputs remain in ignored local storage. The release package
contains only tracked source and previously approved public media; no private
original video, XRK, inspection cache or local anchor storage is included.
