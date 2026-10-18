# Real Top 3 Review and Synchronization Diagnostics

## Changes

- Add `top_lap_segments` from existing quality-gated real lap splits. Show each
  sector's shortest lap and whether the same pair's advantage survives the next sector.
- Add one-click pair selection in AI Coach Summary, reusing local dual-video
  previews, manual crops, confirmed per-lap anchors and review feedback.
- Keep missing video/calibration/edge coverage unavailable. No video uploads,
  synthetic target laps, new pedal inferences or time-warped comparisons.
- Separate GPS/timing-based positioning from human-confirmed landmark explanations.
- Expose GNSS estimator differences and the worst held-out speed window. Retain
  existing thresholds, weak-candidate status and manual-anchor priority.
- Extend local audit scripts and refresh only the approved public demo's split
  summary. Private files, outputs and screenshots remain ignored and local.

## Acceptance

- Backend pytest with a private XRK configured: **272 passed**, no skipped tests.
- Frontend: **143 passed**; coach debrief: **12 passed**.
- GNSS: **21 passed**; RPM sync: **27 passed**.
- API proxy: **6 passed**; rendered Sites HTML: **11 passed**.
- Lint, Sites build, Next/Vercel build and API proxy dry-run build passed.
- Local browser: real XRK import, real split values, real pair selection, both
  manual video previews, playback, unconfirmed-sync state, English switch and
  mobile width verified. No page errors; only local inspect/analyze POSTs.
- Original video remained a browser blob; both players decoded real 1920x1080
  frames. Preview playback does not mean frame-level synchronization was confirmed.
- Docker is not installed on this development machine, so local
  `docker compose config` / container execution could not be checked.
- An existing FastAPI/Starlette httpx deprecation warning remains; tests pass.

## Limits

The private GNSS audit still yields a weak candidate: a held-out speed window
exceeds the unchanged tolerance. Differing clock estimators on staircase receiver
timestamps are not proof of physical drift. Retain checked manual anchors.
GPS-distance sector boundaries are not official physical gates. Small observed
differences are descriptive, not significant improvements or causal driving advice.

See [the feature contract](../TOP3_SEGMENT_REVIEW.md) for workflow and commands.
