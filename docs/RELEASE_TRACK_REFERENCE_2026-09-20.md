# Track Reference Release - 2026-09-20

## Public deployment

- Frontend: https://ai-racing-telemetry-platform.vercel.app
- Backend: https://racing-ai-platform-api-production.up.railway.app
- Railway deployment: `98a591db-bb10-4c60-b12f-85f33393e437` (SUCCESS).
- Vercel deployment: `dpl_G8Wrk35ixsUDvskd2kUSeVixx33S` (READY, production alias assigned).
- Published backend first, then frontend. No runtime API origin or cloud boundary was relaxed.
- The historical Sites frontend was not republished in this release; its allowed CORS origin remains supported.

## Included changes

- Server-resolved feedback provenance; demo submissions are rejected. Historical
  unknown feedback remains stored but excluded from real-source statistics.
- Native-GPS observed track reference, bounded per-lap translation, directed
  spatial gates and separate platform timing. Existing quality gates and Top 3
  performance references are unchanged.
- Bilingual Track Map > Fixed track reference workspace, manual gate editing,
  local configuration import/export and per-lap validation results.
- Gate-bounded GPS kinematic phases remain provisional and report missing stages.

SQLite was backed up on the existing persistent volume before the additive
`data_origin` migration. The backup and post-migration database both passed
`PRAGMA quick_check`. Temporary deployment SSH access was revoked afterward.

Deployment used a source-only staging directory. Private XRK/XRZ, videos, local
track configurations, Parquet, databases, credentials and private audit outputs
were excluded. Only the already-reviewed public demo resource was included.

## Verification

| Check | Result |
| --- | --- |
| Backend pytest with private local XRK directory configured | 228 passed |
| Frontend tests | 133 passed |
| Lint | Passed |
| Sites/vinext build | Passed locally; not published |
| Next/Vercel build | Passed locally and on Vercel |
| API proxy tests / dry-run build | 6 passed / passed; proxy not changed |
| Local Docker Compose validation | Not run: Docker unavailable on this machine |
| Railway Linux image build / native parser import | Passed; libxrk 0.12.0 |
| Health, readiness and configured LLM capability | Passed after release |
| CORS for Vercel and historical Sites origins | Passed |
| New reference endpoint with expired token | 410 with public error code and request ID |
| New match endpoint with missing fields | 422, no traceback |
| Demo feedback rejection, direct and same-origin | 422 DEMO_FEEDBACK_DISABLED |
| Legacy import and inspect invalid-format rejection | 400 |
| Public browser, 1440px and 390px | Passed; new panel present, zh/en, no page errors or document overflow |
| Public demo feedback network writes | None |

Real-file import, reference creation, matching, gate editing and configuration
round trips were tested locally. Public smoke tests intentionally did not upload
private logs or create accepted feedback records. Native parser availability and
invalid-format rejection do not constitute a new real-file public parsing test.

## Use and remaining validation

Upload a real XRK, open **Track Map**, then **Fixed track reference**. Create a map
from a genuine eligible reference lap. Confirm the timing line against video,
review/merge candidate corner intervals, name them, and check both directed gates.
Save or export the configuration before inspecting another session.

Curvature peaks are not official corner names. Translation residuals do not
independently prove GPS bias or remove driving-line differences. A different
timing line changes individual lap endpoints, so platform and logger lap times
remain separate. Short/double passages at registration seams are rejected using
observed travelled distance. Missing phases are not fabricated.

The module is provisional until video/coach validation. It does not train a model,
replace the current consensus, generate synthetic performance targets, or claim
independently validated sensor/driver dynamics. See [Track Reference](TRACK_REFERENCE.md).

## Rollback identifiers

- Previous Railway: `81edafee-fa90-493a-bac5-f5bb88bd3f3f`.
- Previous Vercel: `dpl_9tapADtRERd34vKpZT3ZbpFR71hT`.

The database change is additive. Do not drop provenance columns or restore the
backup over newer user feedback without a separate recovery decision.
