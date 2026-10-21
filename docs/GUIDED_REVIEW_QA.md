# Guided Review QA - 2026-10-21

## Scope

First-time-driver acceptance used the user-authorized real paired GoPro/AiM
recording in a new browser context, not the user's existing browser profile.
The initial public `/review` completed all six steps against the public backend.
The full GoPro recording stayed in the browser; only the authorized XRK and small
analysis request bodies reached the service. Temporary inspections were deleted.

The known manual start was retained. The test end used the corresponding logger
lap duration to exercise the UI; it is a test input, not an independently checked
finish-line annotation. Feedback requests were intercepted and acknowledged only
inside the isolated test browser, so test choices did not enter the public coach
label table. This tests workflow propagation, not correctness of driving advice.

## Findings and fixes

- Both-video playback controls were below long timing, landmark and feedback
  sections. They now sit above the videos and bring the pair into view.
- Recommended clips now show pending, both-confirmed or rejected status, using
  the same current-clip receipt gate as the debrief. A single vote is insufficient.
- Debrief now retains the real eligible fast-lap times and names pending pairs.
  Confirmed comparisons and custom-corner results still carry forward. Missing
  confirmations do not become training recommendations.
- Published video had deliberately omitted audio and GPMF. Nine already-approved
  five-second clips now retain AAC audio, with a one-side-at-a-time sound selector.
  Their real GPS5 speed samples are published in a sanitized relative-time
  sidecar and displayed on presented frames and seeks. Raw GPMF, coordinates,
  UTC, full recordings and private telemetry are not published.
- No synchronization threshold, manual anchor, lap-quality or consensus rule
  changed. GPS-inconsistent warnings and +/-0.5-second manual uncertainty remain.

## Acceptance

- Six-step real-file flow: overview, manual lap pairing, recommended pair,
  selected-corner search/grouping, debrief and Markdown download.
- Both saved clip receipts reach debrief; unconfirmed pairs remain pending.
- All eligible selected-corner candidates are returned. The tested section has
  no clear pattern separation; the interface does not force a classification.
- Forward/back navigation and bilingual/mobile views retain the same anchors.
- Demo: all nine files have H.264 and AAC, no raw metadata track; GPS speed is
  bounded to the matching excerpt and changes during playback/seek. Audio
  decoding is non-silent; changing audio source mutes the other player.
- Backend: 291 tests passed with the opt-in private real-sample test enabled.
- Frontend: 165 passed; guided review 8; coach debrief 13; video comparison 13;
  selected corner 4; GNSS 26; RPM sync 27; proxy 6; rendered HTML 12.
  Some suites overlap and these counts must not be summed.
- Lint, Sites build, Next/Vercel build and proxy dry build passed. Public health,
  readiness, parser, LLM capability and runtime-origin checks passed.
- Docker was unavailable locally; Docker build/run was not performed.

Private screenshots, traces, input paths and sample responses remain under
ignored `tmp/`. Reproduce with a fresh browser context, never by clearing or
modifying an existing driver's saved synchronization.
