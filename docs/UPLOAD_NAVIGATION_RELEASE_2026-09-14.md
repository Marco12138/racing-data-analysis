# Public Upload And Navigation Release

Date: 2026-09-14. Frontend: Vercel. Backend: Railway.

## Diagnosis And Boundaries

- Runtime configuration points XRK uploads directly to Railway, not localhost
  or the optional Cloudflare proxy.
- Railway history contains two rejected `OPTIONS /api/v1/xrk/inspect` requests
  on September 11. The old logs did not include the requested origin or headers;
  the exact cause of those rejections cannot be established retrospectively.
- Both approved production origins passed preflight checks during this work.
  Health/capability availability alone is not proof of a successful upload.
- The browser now sends the standard multipart `file` field, without manually
  setting Content-Type or a custom filename header. It first materializes the
  complete file into an independent Blob to retain the Safari file-read fix.
- Empty/oversize selections are rejected before upload; read status, file size,
  cancellation and same-file reselection are supported. There is no automatic
  retry that could trigger duplicate parsing.
- Legacy binary uploads remain supported. Origin restrictions, signature
  validation, temporary deletion and cloud filesystem boundaries are unchanged.
- Rejected preflights now log the request ID, origin, method and header names,
  never credential values or uploaded contents.

The user's latest failing file/browser combination was not supplied or reproduced.
Do not treat the successful checks below as proof that every upload failure is fixed.

## Navigation

Shared bilingual navigation now separates the functional destinations:

| Route | Purpose |
| --- | --- |
| `/workspace` | Telemetry import and real-lap analysis |
| `/video-coach` | Existing browser-local video workspace |
| `/methods` | Methods, evidence limits and live service capability status |
| `/about` | Project scope, data handling and workflow entry points |

The home and demo pages use the same navigation. Chinese/English controls switch
the new explanatory content; both language labels remain visible in navigation.
The existing experimental video analysis is not reclassified as validated analysis.

## Verification

- Backend without private fixtures: 180 passed, 1 skipped.
- Backend with `XRK_TEST_DATA_DIR`: 188 passed, including private XRK regressions.
- Frontend suite: 101 passed; rendered-route checks: 11 passed.
- Corner-dynamics frontend checks: 5 passed; optional API proxy checks: 6 passed.
- Lint, Sites build, Next/Vercel build and API proxy dry-run build passed.
- Real-file multipart import was tested locally: inspection, channel/lap data,
  GPS analysis and report succeeded; the inspection token was explicitly deleted.
- No private XRK was sent to production. A non-private invalid-signature multipart
  probe on the new Railway deployment reached signature validation and returned
  `XRK_UNSUPPORTED_FORMAT`, not `XRK_UPLOAD_MISSING_FILE`, with the approved CORS
  response. This verifies request transport, not successful native file parsing.
- Public browser checks covered navigation, method/status display, language
  switching and responsive layout. Public health/readiness/parser/LLM checks passed.
- Local `docker compose config` was not run successfully because Docker is not
  installed. Railway's Linux Docker build and deployment succeeded independently.

## Deployment References

- Public frontend: https://ai-racing-telemetry-platform.vercel.app
- Vercel deployment: `dpl_8RryDQKF97CdmsRCkpKgF6VNfC4N`, READY.
- Railway deployment: `127621cf-2a89-4099-972c-38031d0648f2`, SUCCESS.
- Existing pending statistical corrections were preserved and included in this
  release; see `CORNER_PHASES_AND_REPEATABILITY.md` for their assumptions.
- This deployment was made from the working tree. No Git commit or push was
  performed as part of this release task.

## Next User Check

Reload the public `/workspace`, select the previously failing file and start
inspection. If it fails, retain the full error code/request ID, filename, file
size and browser name. Use the new preflight diagnostics where relevant rather
than relaxing CORS or claiming a parser defect from a transport error alone.
