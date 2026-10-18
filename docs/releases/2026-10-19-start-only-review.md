# Start-only five-second review

## Scope

Frontend-only, backward compatible. Railway analysis, synchronization thresholds,
API-origin policy and real-lap quality gates are unchanged. Existing manual lap
anchors and custom clip revisions are preserved.

- One reference-lap start distance is reused on both real laps.
- Short previews last exactly five seconds, without padding or time stretching.
- Manual confirmation needs only a start. A local clip revision retains +/-0.5s
  picking uncertainty, the proposal and the original source anchor.
- Background comparison offers start/end images and bounded candidate searches;
  neither similarity nor explicit crop confirmation clears GPS warnings.
- GPS diagnostic intervals persist locally, scoped to session and file identity.
- English/Chinese controls and advanced custom durations remain available.

## Local acceptance

The supplied private XRK and original GoPro video were used only against local
services. The browser extracted real GPMF and the local backend returned the
existing weak GNSS result. The failed interval remained visible in the affected
target clip, including after a clip-specific manual edit.

The browser exercised one confirmed lap anchor and two inferred Top 3 clips,
decoded four boundary images, reported ambiguous background evidence, confirmed
one start, stopped at start +5s, restored the local revision and preserved the
original global anchor/history byte-for-byte. The test's confirmation click is
an interaction fixture, not a new coach truth label or measured accuracy claim.
Desktop and 390px mobile screenshots were visually reviewed; there were no
page errors, video uploads or feedback submissions. Private results are ignored
under `tmp/review-start-only-20261019/`.

## Checks

- Backend: 286 passed with `XRK_TEST_FILE_PATH` configured; existing Starlette
  deprecation warning only.
- Frontend: 158 passed; coach debrief: 12; GNSS: 23; RPM: 27; proxy: 6.
- Rendered HTML: 11 passed.
- Lint, Sites build, Vercel build (including its TypeScript check), proxy dry-run:
  passed.
- Public health/database/parser/LLM/runtime/CORS verification: passed before
  release; repeat after publication.
- Docker is not installed locally, so `docker compose config` was not run.
- An additional unscoped `tsc --noEmit` was attempted. It still includes ignored
  historical `tmp/` source copies, proxy fixtures and unused D1 scaffolding and
  reports existing errors outside this change. The repository's prescribed
  Vercel-scoped production TypeScript check passes. These unrelated areas were
  not refactored to conceal that distinction.

## Publication

Publish the same Git commit to GitHub, Vercel and the existing public Sites
project. No backend redeployment is required. Verify the production workspace,
approved public demo and new client controls without uploading private footage.

Existing browser diagnostics predate this cache: run the GPS timing check once
again to retain its segmented warnings for coach review. Missing cached evidence
is explicitly unavailable, never an automatic pass.
