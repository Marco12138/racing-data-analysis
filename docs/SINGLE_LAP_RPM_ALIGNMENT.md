# Single-Lap RPM Alignment

## Driver Workflow

1. Import the real XRK session, enter analysis, and open **Lap Analysis / 单圈分析**.
2. Choose **Telemetry lap / 对应遥测圈** in the synchronization panel. Options come
   from that session's actual timed laps, with recorded lap time alongside each.
   Slower target laps are allowed; this does not make them reference-eligible.
3. Load the matching onboard video locally. Set the video segment start and end
   with the numeric inputs or the existing lap start/end marker buttons.
4. Choose the engine type and run **Auto-align from audio RPM / 音频 RPM 自动对齐**.
   Confirm the match using a visible shared event. A manual anchor is never
   overwritten without explicit confirmation.
5. Choose another lap to review it. The map, gauges and comparison target follow
   the selected lap. Select that lap's corresponding video segment as needed.

Choosing a lap cannot prove the video belongs to it. Low confidence or interfering
engine sources leave the offset unchanged. Manual synchronization remains the
fallback. A 0.1-second search grid is not a claim of 0.1-second accuracy.

## Implementation

- `backend/app/api/xrk_routes.py`: optional `lap` on the existing RPM alignment
  endpoint. It requires a temporary inspection and never widens a missing-lap
  request to a session search.
- `backend/app/analysis/video_telemetry_sync.py`: filter before summarization;
  preserve session timestamps; search only sufficiently overlapping shifts.
  Late-session laps are not restricted to the previous +/-300-second window.
- `frontend/lib/audioRpm.ts`: only the selected video segment enters STFT and
  RPM tracking. Native browser audio decoding still reads the complete file.
- `frontend/components/XrkAnalysisWorkspace.tsx`: actual-lap selector, segment
  controls, reusable in-memory RPM trace, cancellation and stale-result guards.
- `frontend/lib/xrkAnalysisApi.ts` and `frontend/lib/i18n.ts`: compatible request,
  response and bilingual controls.
- `frontend/lib/videoGauge.ts`: preserve normalized km/h; show unavailable
  outside the target lap's actual time coverage instead of repeating endpoints.
- Tests: `backend/tests/test_video_telemetry_sync.py`, `tests/audio-rpm.test.mjs`,
  `tests/video-session.test.mjs`, `tests/video-gauge.test.mjs`.

No new dependencies, raw video upload, synthetic reference lap, or change to the
Lap Quality Gate / Top 3 consensus. Old clients omitting `lap` remain supported.

## Local Verification (2026-09-15)

- Backend: 195 passed with the private XRK directory configured.
- Frontend: 107 passed; rendered-route tests and API proxy tests passed.
- Known-clock tests recover a late-session lap offset within the search grid,
  select only the requested lap among repeated signals, and reduce candidates.
  Those generated signals exist only in tests, not user analysis results.
- Browser test imported a private real session locally, listed all 13 timed
  laps, and switched from Lap 8 to Lap 13 without inventing a reference.
- The previously supplied 42.6-second onboard video was decoded locally; its
  2-40-second segment completed a Lap 13 matching request. That pair has no
  independently confirmed correspondence. The low-confidence result (42%) was
  rejected and offset stayed unchanged, as required.
- Desktop/mobile controls were inspected; the local temporary inspection was
  deleted after verification. Private media and telemetry were not deployed.
- Lint, Sites and Next/Vercel builds passed. Docker is absent locally, so local
  Compose validation could not run; Linux image verification is via Railway.

## Remaining Validation

Use a video with a known session/lap match and mark at least one visible shared
event independently. Check near the beginning and end before relying on the
offset for coaching. No empirical accuracy improvement is claimed yet; narrower
search and fewer computed samples are implementation changes, not ground truth.

## Deployment

- Railway deployment `68999d13-e06c-4c7b-9644-75152d19d6ec`: SUCCESS; Linux
  image build and readiness check passed.
- Vercel deployment `dpl_2GK7N5UEVK1UoF8JNTKUjxGmPybk`: READY and aliased to
  https://ai-racing-telemetry-platform.vercel.app.
- Public health, readiness, parser, LLM availability and runtime routing passed.
  A non-private expired-token probe confirmed the RPM endpoint accepts `lap`
  and preserves its 410 error contract. No private XRK was sent to production.
- Deployed from the working tree; no Git commit/push was made in this task.
