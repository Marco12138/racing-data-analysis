# Guided Review

Guided route: `/review`. The existing `/workspace`, analysis algorithms,
quality gates, API origin checks and public deployment configuration are unchanged.
The owner approved publishing the locally reviewed flow on 2026-10-21. The homepage
and shared navigation link to `/review`; the original `/workspace` remains a
separate free-workspace entry. Deploy through the existing Vercel project with the
Railway backend unchanged. Follow the release checks before promotion.

Six steps: import -> session overview -> pair a real lap -> recommended clips ->
optional custom corner -> debrief. The free workspace toggle retains the same
analysis component. Video pairing, recommended clips and custom-corner components
stay mounted between steps; hidden media is paused and hidden pairing keyboard
shortcuts are disabled. A different inspection resets the workspace. Original
manual anchors retain their existing local storage and uncertainty rules.

The debrief only includes recommendations whose two current video clips have
saved, synchronized, accurate receipts. Rejected/uncertain/stale receipts stay
separate. Confirmation proves clip identity, not pedal causes. Custom-corner
results are shown only while their grouping is current. No fresh LLM request,
synthetic target lap, or sum of local gains is introduced. Markdown export is
generated locally. Temporary inspection expiry remains unchanged.

Refresh keeps existing anchor storage but requires reopening the local video;
custom selections and the in-memory guided flow are not persisted across refresh.
Switching to a different Session starts a new review. CSV and published samples
continue to use the existing free workspace; the guided live-video path is XRK/XRZ.

Checks: `pnpm run test:guided-review`, all existing release checks, then local
Chrome desktop/mobile acceptance with private XRK + GoPro. Exercise back/next,
free/guided toggle, changed files, missing video, expired token, anchor preservation,
custom selection/confirmation retention, and bilingual debrief exclusions. Private
fixtures and browser artifacts belong only under ignored `tmp/`.

## Local startup

Start a loopback backend with the existing development configuration on port 8004.
Then run the frontend on an unused port (3116 in this acceptance run):

```bash
LOCAL_NEXT_DIST_DIR=.next-review \
DEPLOY_TARGET=vercel NEXT_PUBLIC_DEPLOYMENT_MODE=local \
NEXT_PUBLIC_API_URL=http://127.0.0.1:8004 API_URL=http://127.0.0.1:8004 \
XRK_UPLOAD_URL=http://127.0.0.1:8004/api/v1/xrk/inspect \
pnpm run dev:next --hostname 127.0.0.1 --port 3116
```

The backend's local `CORS_ORIGINS` must include `http://127.0.0.1:3116`.
`.next-review` isolates this preview from another existing Next development server;
the production build directory and public API origin guards are unchanged.

## Local acceptance, 2026-10-21

- Backend: 291 passed with the private XRK acceptance sample; one dependency
  deprecation warning, no skipped tests.
- Frontend main suite: 162 passed. Guided-review suite: 8 passed.
- Coach, selected-corner, video, GNSS, RPM and proxy regression checks passed.
- Lint, Sites build, Next/Vercel build, proxy dry-run build and 11 rendered-HTML
  checks passed. Some regression suites overlap; counts are not a unique total.
- Desktop Chrome and a 390px mobile viewport completed the local paired-file
  flow. Navigation retained the manual anchor, selected corner and confirmation;
  hidden media paused, new imports did not inherit old lap/video choices, invalid
  uploads showed a visible error, and the console had no uncaught errors.
- Browser confirmations were UI-test inputs, not human labels or validation of
  video synchronization. No feedback API was called; no private files were
  uploaded to the public backend. These results describe the local preview before
  publication, not a production upload or human synchronization acceptance.

## Publication checks, 2026-10-21

- Re-ran backend acceptance: 291 passed, one existing Starlette/httpx dependency
  warning. Frontend: 162 passed; guided: 8; selected corner: 4; coach debrief: 12;
  video comparison: 13; GNSS: 26; RPM sync: 27; API proxy: 6. Suites overlap.
- Lint, Sites build, Next/Vercel build, proxy dry-run and 12 rendered-HTML tests
  passed. The new route and original free workspace are checked separately.
- Re-ran the full local private-file flow and five public entry routes at
  1440px, 390px and 320px. Fixed narrow English import layout overflow; confirmed
  bilingual mode switches and no uncaught page errors.
- Existing public Railway health/readiness, parser, LLM capability and Vercel
  same-origin routing checks passed before release. No API configuration changed.
- Deployment input dry-run excludes private XRK, raw videos, temporary caches,
  databases and `.env.local`; only previously reviewed public demo assets ship.
- Docker CLI is unavailable on this machine, so `docker compose config` was not
  executed. Backend/container runtime configuration is unchanged.
