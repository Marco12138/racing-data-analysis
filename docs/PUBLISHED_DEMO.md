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

### Public browser follow-up, 2026-10-27

The public desktop demo is now accessible to the browser test tool. On the
merged PR #49 deployment, all six Chinese steps loaded; all three recommendation
texts matched the debrief, and returning from a summary selected the correct
section. Candidate arrows/dropdowns, independent playback clocks, pause and the
left/right/mute states were exercised. English review controls also rendered.

This exposed two playback defects: changing the right candidate left the other
player at its previous position, and browser timestamp truncation put some entry
seeks a few microseconds before the exact telemetry gate. The fixes remount both
paused players when a pair changes and round playback seeks inward to millisecond
precision. Evidence times, spatial gates, validation tolerances and the manual
anchor are unchanged. Regression tests cover all nine published excerpt clocks.
Recheck these two interactions against the released artifact before closing them.

Browser download permission was denied for the summary export; that interaction
remains unverified and must not be retried through another transfer mechanism.
Audio track presence and mute routing do not establish sound heard from physical
speakers. Physical listening, mobile/other-browser testing and independent visual
confirmation of the original anchor remain outstanding. No private inputs were
selected or uploaded. Preserve the pre-fix production deployment
`dpl_Bufsqo9QbBxsRPkKJ5K22dfahGsp` for rollback.

### Responsive, seek and export follow-up, 2026-10-28

The public sample now permits summary downloads. Both Chinese and English
Markdown exports downloaded through the visible button; all fifteen observation
paragraphs matched their on-screen debrief, including the GPS and +/-0.5s
limitations. This supersedes the earlier download-permission blocker.

Native timeline drags on the public sample changed only the selected video's
clock and its speed/RPM readings. Ready, paused readouts were independently
interpolated from that lap's published telemetry and matched. One observation
during seeking was excluded until media became ready; no validation tolerance
or evidence timestamp was changed.

Native mute exposed a real control mismatch: muting the selected video left the
page's audio selection active, so clicking that same selection did not restore
sound. The player now reports native mute/unmute changes to the shared selection,
while ignoring events caused by applying the controlled mute property. Local
browser regression confirmed mute selection and restoration. Narrow screens use
two step columns below 380px to avoid splitting short English labels.

All six steps were exercised in both languages at 320x740, 390x844 and 844x390
browser viewport sizes with no document-width overflow. These are desktop-browser
responsive tests, not physical phone or touch-browser certification. Actual
speaker listening, iOS/Android hardware, other browser engines, independent anchor
accuracy and complete corner coverage remain unverified. The immutable public
media, manual anchor and GPS warnings remain unchanged; no private inputs were
opened or uploaded. Release receipts and post-deployment results are kept locally
under ignored `tmp/demo-mobile-qa/`.
