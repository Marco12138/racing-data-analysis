# Deployment Guide

## Stage 1 public demo

The current public demo only needs:

- Frontend: Vercel, built with `pnpm run build:vercel`.
- API: Railway using the root `Dockerfile`.

CSV analysis and video first-frame preview run in the browser. AiM XRK/XRZ
files are sent to the FastAPI container for temporary parsing. The API is
required for XRK/XRZ import, the optional server-side CSV endpoint, and
health/capability checks. PostgreSQL, Redis, authentication, and object storage
are intentionally not required in this phase.

Railway runs the existing Linux container, including OpenCV, FFmpeg, PyArrow,
and the native `libxrk` wheel. Coach Pilot v1 uses one worker and a Railway
Volume mounted at `/data` for SQLite persistence. Horizontal scaling still
requires shared inspection storage and a multi-user persistence layer.

## Local environments

Install development dependencies:

```bash
python -m pip install -r requirements-dev.txt
pnpm install
cp .env.development.example .env.local
```

Run the existing launcher or the services separately:

```bash
./scripts/start-local.sh
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
pnpm run dev
```

The backend loads `.env`, then `.env.<APP_ENV>`, then `.env.local`. Operating
system environment variables take precedence. Next.js loads its standard
`.env*` files at build/run time.

## Docker development

The compose file mounts `~/Movies/Videos` read-only and preserves SQLite/cache
data in a named volume:

```bash
docker compose up --build
```

Open `http://localhost:3000`. Stop with:

```bash
docker compose down
```

## Vercel frontend

1. Import the repository into Vercel.
2. Keep the repository root as the project root; `vercel.json` selects the
   standard Next.js production build.
3. Set:

```text
NEXT_PUBLIC_API_URL=https://racing-ai-platform-api-production.up.railway.app
NEXT_PUBLIC_API_PREFIX=/api/v1
NEXT_PUBLIC_DEPLOYMENT_MODE=public-demo
API_URL=https://racing-ai-platform-api-production.up.railway.app
XRK_UPLOAD_URL=https://racing-ai-platform-api-production.up.railway.app/api/v1/xrk/inspect
```

These values are embedded in browser assets at build time. Redeploy after they change.

## Sites frontend

Set these Worker runtime values in Sites:

```text
API_URL=https://racing-ai-platform-api-production.up.railway.app
API_PREFIX=/api/v1
DEPLOYMENT_MODE=public-demo
```

The Worker exposes only these public values through same-origin
`GET /api/runtime-config`. The browser uses that response for XRK inspection,
analysis, deletion, and capability requests. HTTPS pages reject loopback or
non-HTTPS API origins. `pnpm run build` scans client assets and fails when a
literal `http://127.0.0.1:8000` or `http://localhost:8000` is present.

## Railway FastAPI backend

Create one Railway service from this repository and let `railway.toml` select
the root `Dockerfile`. Attach a Railway Volume at `/data` before inviting pilot
users. The volume keeps SQLite feedback, storyboard, and session metadata across
deployments; temporary XRK inspection artifacts still expire after 30 minutes.
The container entrypoint prepares the mounted directory and then drops to the
unprivileged `appuser`; do not override it with a custom Railway start command.

Set the following service variables:

```text
APP_ENV=production
APP_MODE=cloud
API_HOST=0.0.0.0
API_PORT=8000
DOCS_ENABLED=false
CORS_ORIGINS=https://ai-racing-telemetry-platform.vercel.app,https://ai-racing-telemetry-platform.marcosebastian1144.chatgpt.site
ALLOWED_HOSTS=racing-ai-platform-api-production.up.railway.app,healthcheck.railway.app,localhost,127.0.0.1
DATABASE_PATH=/data/racing.sqlite
STORAGE_BACKEND=local
TASK_QUEUE_BACKEND=inline
WEB_CONCURRENCY=1
MAX_XRK_UPLOAD_BYTES=52428800
XRK_PARSE_TIMEOUT_SECONDS=60
XRK_MAX_CONCURRENT_IMPORTS=2
XRK_RATE_LIMIT_PER_HOUR=10
XRK_MAX_RESPONSE_ROWS=30000
XRK_INSPECTION_TTL_SECONDS=1800
XRK_INSPECTION_CACHE_DIR=/tmp/racing-xrk-inspections
XRK_DEFAULT_DISTANCE_STEP_M=1.0
XRK_MAX_COMPARISON_POINTS=5000
XRK_SERVER_IMPORT_ENABLED=true
XRK_PARSER=auto
```

Keep `WEB_CONCURRENCY=1` while inspection tokens and Parquet artifacts are on
the container-local `/tmp` filesystem. Railway provides
`RAILWAY_VOLUME_MOUNT_PATH` when a volume is attached, but the application uses
the explicit `DATABASE_PATH` so its persistence contract is visible and
testable.

Verify every deployment before publishing it:

```bash
curl --fail https://racing-ai-platform-api-production.up.railway.app/api/v1/health
curl --fail https://racing-ai-platform-api-production.up.railway.app/api/v1/system/health/ready
curl --fail https://racing-ai-platform-api-production.up.railway.app/api/v1/system/capabilities

# Use a private local sample; never commit it.
curl --fail -F "file=@/absolute/path/session.xrk" \
  https://racing-ai-platform-api-production.up.railway.app/api/v1/xrk/inspect
```

The `railway.toml` health check targets the readiness endpoint, and the restart
policy keeps the single pilot worker available after process failures. Railway
deployments with an attached volume may have a short restart window; do not
promise zero downtime for Coach Pilot v1.

Railway has deprecated Config as Code and documents a 2026-12-01 cutoff for
existing `railway.toml` services. Migrate this existing service to
`.railway/railway.ts` before that date; do not combine that infrastructure
migration with pilot analysis changes.

This cloud-mode container is suitable for publishing the frontend and CSV
analysis API. XRK/XRZ files are parsed in an isolated subprocess. The raw file
is deleted immediately; normalized Parquet and its manifest use an opaque token
with a fixed 30-minute expiry so users can change laps, sectors, or zones
without uploading again. Cloud mode deliberately
disables local video discovery and is **not a multi-user video service**.

Keep `WEB_CONCURRENCY=1` while inspection artifacts are on the container's
local `/tmp` filesystem. Before horizontal scaling, move these artifacts to
shared object storage and retain the same opaque-token contract.

The XRK report can optionally add an evidence-bounded Chinese coaching
narrative through an OpenAI-compatible chat completions endpoint:

```text
# deepseek-chat typical endpoint: https://api.deepseek.com/v1
# OpenAI official endpoint:       https://api.openai.com/v1
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=<your-api-key>
LLM_MODEL=deepseek-chat
```

- Set these on the backend deployment only; never prefix them with
  `NEXT_PUBLIC_` and never commit the key.
- `GET /api/v1/system/capabilities` exposes `llm_narrative.available` and
  `llm_narrative.model` but never the key.
- When unset, the API keeps the structured, language-aware fallback and
  behavior is unchanged.
- The narrative layer only restates numbers present in the evidence; outputs
  without numbers, without corner/distance anchors, or with vague filler are
  rejected and fall back to the structured summary.
- `scripts/evaluate_narrative.py` performs a bounded read-only quality
  evaluation (10 sessions x 2 languages = 20 LLM calls at most) and writes
  samples under `tmp/narrative_eval/`.

### 点亮 LLM 一键流程

1. **Railway Dashboard** → API service → **Variables**，添加
   `LLM_BASE_URL`（DeepSeek 用 `https://api.deepseek.com/v1`）、
   `LLM_API_KEY`、`LLM_MODEL=deepseek-chat`，然后重新 Deploy。
2. 验证连通性（本地，脚本只从环境变量读 key，不写盘不打日志）：
   ```bash
   LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=deepseek-chat \
     python scripts/verify_llm_config.py
   ```
   也可以在 Railway service shell 中执行同一命令；不要把 key
   写入文件或日志。
3. 生成评估样本。脚本会先执行与第 2 步相同的最小连通性验证；验证失败时
   不创建评估结果。随后优先读取 `tmp/narrative_eval/samples/*.json` 中的真实
   analyze 响应，并为每个 session 生成中文和英文叙事。如果没有真实样本，
   会明确标记为 `demo-artifact`，该结果只能用于流程冒烟：
   ```bash
   python scripts/evaluate_narrative.py --limit 10 --languages zh,en
   # 快速冒烟（不调用 LLM）：
   python scripts/evaluate_narrative.py --dry-run
   ```
4. 查看决策输出：
   ```bash
   python scripts/print_evaluation_verdict.py
   # 或指定目录：python scripts/print_evaluation_verdict.py --path tmp/narrative_eval/<timestamp>/summary.json
   ```
   同时阅读 `tmp/narrative_eval/<timestamp>/report.md`。`summary.json` 包含五个
   维度的胜负计数、胜率和 `overall_recommendation`；`report.md` 包含中英文
   LLM 叙事与结构化基线全文，供人工逐项复核。
5. **决策标准**：人工按具体性、准确性、语言、可执行性和安全性五个维度复核。
   只有真实 session 中的 LLM 输出在五个维度都全面优于结构化回退，才建议
   `ENABLE_LLM`；任一维度持平、落后，或只有 demo 工件，都保持
   `KEEP_STRUCTURED`。脚本 verdict 是保守预筛，最终仍由人工阅读 `report.md`
   后决定是否全量点亮。

All three values are required. If any value is missing, the request fails, or
the generated text contains a number absent from the compact structured
evidence, the API omits `narrative` and keeps the existing template report.
Cloud mode accepts only an HTTPS LLM endpoint. Never expose `LLM_API_KEY` to
the frontend or give it a `NEXT_PUBLIC_` prefix.

### LLM 质量迭代与反馈闭环

每次调整 Prompt 后，按同一组真实 session 重复以下流程：

```bash
python scripts/evaluate_narrative.py --limit 10 --languages zh,en
python scripts/analyze_eval_report.py
python scripts/render_feedback_stats.py
```

- `evaluate_narrative.py` 会在评估目录中自动生成
  `prompt_refinement_report.md`；独立运行 `analyze_eval_report.py` 可重新分析
  最新结果，归类缺少弯角锚点、练习不具体、语言混用、未落地数字和禁词。
- `render_feedback_stats.py` 以只读方式统计 SQLite 的
  `narrative_feedback`，按 source、locale、node_id 聚合赞踩，并列出被点踩最多
  的节点和模式。部署环境使用持久卷时，应在能读取该卷的后端环境中运行；也可用
  `--database /path/to/sessions.sqlite3` 指定副本。脚本不会修改数据库。
- Prompt 或后处理改动只有在真实样本五个维度均优于结构化基线时才可发布。
  命中禁词、没有证据数字或缺少“位置 + 动作 + 练习 + 停止条件”时继续回退。

### 微信分享长图

打开一个已生成的复盘短片，在操作区选择“导出朋友圈长图”。浏览器会在本地生成
1080×1920 PNG，包含车手、车辆、赛道、最快真实有效圈、前三个教学点、分享页
二维码和 AI 核实水印。二维码和图片均在浏览器中生成，视频不会上传服务器。

公开分享页会从后端读取 storyboard 摘要生成动态 Open Graph 标题，并使用
`public/og.png` 作为静态品牌图。部署前确认 Vercel 的 `API_URL` 能由服务端访问，
否则分享页本身仍可打开，但爬虫无法取得最快圈标题。

Use these health checks:

```text
GET /api/v1/health
GET /api/v1/system/health
GET /api/v1/system/health/live
GET /api/v1/system/health/ready
GET /api/v1/capabilities
```

`GET /api/v1/health` has the stable response:

```json
{"status":"ok"}
```

## Future commercial launch gate

Do not enable public video uploads until all of the following are implemented:

The first owner-scoping foundation is implemented for the existing SQLite
tables, while the public Demo still uses one stable anonymous actor. See
[`P2_PERSISTENCE_BOUNDARY.md`](P2_PERSISTENCE_BOUNDARY.md). This does not make
the service multi-user ready.

1. Replace `utils/storage.py` with PostgreSQL repositories and versioned migrations.
2. Add direct multipart uploads to private object storage.
3. Implement the Redis task dispatcher and a separately deployed worker.
4. Add authenticated ownership checks to jobs, assets, markers, and sessions.
5. Add quotas, signed downloads, rate limits, retention, and deletion workflows.

That future environment can then add:

```text
DATABASE_URL=postgresql+psycopg://...
STORAGE_BACKEND=s3
OBJECT_STORAGE_BUCKET=...
OBJECT_STORAGE_ENDPOINT=...
TASK_QUEUE_BACKEND=redis
REDIS_URL=rediss://...
```

Secrets such as database passwords, Redis credentials, object-store keys, and
JWT secrets belong in the deployment provider's secret manager. Never expose
them with a `NEXT_PUBLIC_` prefix.

## Release checks

### Paired clip telemetry

Speed/RPM panels below each coach-review video and a common-distance time-delta
chart use existing API fields. Run `pnpm run test:clip-telemetry` along with the
checks below. See [Clip Telemetry Review](CLIP_TELEMETRY_REVIEW.md) for timing,
missing-data and uncertainty boundaries. This release is independent of PR #44.

### User-selected corner reviews

The additive `/api/v1/xrk/selected-corner` route supports arbitrary five-second
source selections, real spatial-gate comparisons and exploratory profile groups.
Deploy Railway before the frontend. Run `pnpm run test:selected-corner` in addition
to the checks below. See [Selected Corner Review](SELECTED_CORNER_REVIEW.md) for
manual confirmation, sample-size limits and unchanged synchronization boundaries.

### Local GoPro speed overlay

The two-driver video workspace and AI Coach five-second review show each video's
own GPS5 2D speed (`m/s * 3.6`) over the picture. Optional unaveraged speed samples
are separate from the existing coarse GNSS synchronization payload. Reads remain
browser-local, sparse, bounded, cancellable and shared only for the same `File`.
Neither video nor GPS samples are persisted or uploaded by this overlay.

The HUD follows presented media-frame time, including pause, seek and slow playback.
Packet CTS/timescale and uniformly estimated within-packet timestamps are used;
sensor-to-image latency is still uncalibrated. Linear interpolation is limited to
valid 3D-fix neighbors at most 0.25 seconds apart. No extrapolation, stale-value
hold, cross-file substitution or AiM fallback is permitted. Invalid fixes, bad
samples, gaps, unsupported edits/GPS9, and stripped metadata show unavailable.
Manual anchors, their +/-0.5 second uncertainty and existing GPS anomaly notices
are unchanged. GoPro and AiM readings remain explicitly labelled, not fused.
Speed at the same elapsed video time need not represent the same track position.

This is a browser playback overlay, not a burned-in export. Native video fullscreen
or Picture-in-Picture can omit HTML overlays. Check desktop/mobile playback with
a private metadata-preserving original locally and a metadata-free file; never
add the private original or extracted GPS to public demo assets. Regression tests:
`pnpm run test:video-comparison` and `pnpm run test:gnss-sync`, plus the release
commands below.

### Manual lap binding and visual-score semantics

Single Lap Analysis can bind explicitly marked video start/end to the selected
real AiM lap's logger timestamps (`video_sync.lap_video_ranges`). Both marks and
human confirmation of lap identity/the same timing line are required. The start
defines a constant offset; the end reports a duration residual, not an affine
time stretch or a synchronization accuracy percentage. Similar lap durations
alone do not identify a lap. Review a mid-lap landmark before coaching use.

The legacy visual-motion endpoint retains `confidence` for compatibility and
adds `confidence_kind: heuristic_proxy_score_not_alignment_accuracy` and
`validates_manual_anchors: false`. The UI labels it as an experimental proxy
match score on 0..1, never a percentage accuracy. Low visual scores do not
invalidate manual binding. Changing manual calibration/video/lap cancels stale
visual candidates; raw media remains local. No scoring formula is loosened.

Regression checks include a local browser case with a deliberately mocked 0.39
visual score: the saved real-lap binding must stay identical. That mock is only
a UI regression, never evidence of actual synchronization or telemetry quality.

### GoPro GNSS candidate validation

The GoPro workspace increment and acceptance checklist are in
[GoPro Workspace Plan](GOPRO_WORKSPACE_PLAN.md). New responses add optional
`geometry_check` evidence; older clients keep their original fields. Camera IMU
research stays browser-local. Track-reference v1 accepts legacy maps and adds
server-derived `reference_s_m`, `closing_edge_m` and `length_m` from the final
closed path; contradictory supplied distances are rejected. Deploy the backend
before clients that serialize those additional fields. No public sample or
private recording is added by this change.

The additive `POST /api/v1/xrk/video-sync/gnss` route consumes only bounded camera
GPS summaries and an existing inspection token. Original video and camera IMU
are not uploaded. It requires the native AiM cache and never accepts local paths.
Deploy Railway before the new frontend. See [GoPro GNSS Sync](GOPRO_GNSS_SYNC.md)
for supported files, source/timing limits, private audits and human confirmation.
Run `pnpm run test:gnss-sync` as well as `pnpm run test:rpm-sync` and the checks
below. No analysis-core or automatic manual-anchor override is introduced.

### Multi-window RPM synchronization review

New clients opt in with `verification: true` on the existing
`POST /api/v1/xrk/video-sync/rpm` route; legacy payloads remain unchanged.
The browser extracts a dominant-band candidate and a harmonic-product candidate
on the same 8 kHz, 256 ms **window-center** clock. Audio resampling is
anti-aliased; spectral blocks yield for cancellation. At most 4,000 points per
method leave the browser, never video/audio bytes. Full-file browser decoding
still occurs: the verified path rejects originals over 512 MB before reading
them. Select a same-recording GoPro `.LRV` proxy or a locally trimmed clip.
Proxy and original are not automatically interchangeable without a timing check.

The backend prefers the inspection's native RPM and logger lap boundaries;
older caches explicitly report `normalized_legacy`. Search uses overlap-specific
Pearson statistics, bounded FFT work, no extrapolation, and no interpolation
across gaps over 0.5 seconds. Selected-lap mode retains its actual session clock;
the default legacy search is bounded to the requested offset. New UI requests
also set `search_mode: "overlap"`: offsets are derived from the two actual time
ranges, including GoPro chapters starting long after the logger. This bounded
FFT search does not require the recorder start/end times to coincide and does
not use file creation timestamps. Each source still has the one-hour and
40,000-grid-point processing limits. The best candidate is
refined at 25 ms increments and checked in up to five disjoint windows. Repeated
lap peaks, method disagreement, short/sparse evidence and inconsistent windows
are exposed as reason codes. Thresholds are exploratory, not calibrated success
probabilities; window spread and search increments are not accuracy guarantees.
No drift correction, driver-action inference or multi-session identity claim is
made by this synchronizer.

Overlap mode allows a shared interval shorter than 70% of the shorter recording,
requiring up to 30 seconds (or the caller's larger minimum). Such partial matches
remain weak/unconfirmed and are labelled `PARTIAL_RECORDING_OVERLAP`; fewer than
three usable windows cannot pass. Comparable scores prefer longer evidence.
The response displays both overlap clocks and candidate full/partial lap ranges;
these are time coverage, not independently verified lap identity or gap-free data.
Full-lap confirmation still requires the target lap to be covered. For a partial
corner use each side's existing manual clip anchor; never stretch the recordings
to force both start and end to match. Old payloads keep the previous search mode.

Whole-session location is the default. In selected-lap mode, a video interval
longer than 1.5 times that lap is explicitly ambiguous: another lap can score
higher than the correct one. First locate the session, then restrict the video
to the known lap before refining. A high correlation alone cannot identify a lap.

The UI never auto-applies verified results. It shows real RPM/audio curves,
alternatives and three target-lap review locations. Confirmation requires all
three checks, preserves the real lap clock and creates a local calibration
receipt. Reject/uncertain leave prior calibration intact. Review playback does
not display potentially misaligned gauges. This local judgement is not submitted
as a model-training label. All three checks must be repeated after changing the
lap, video, segment or search mode. Demo inspections cannot request server sync.

Run `pnpm run test:rpm-sync` in addition to the checks below. Private regression
artifacts stay under ignored `tmp/`; no private XRK/video is uploaded for public
smoke tests. Deploy the backward-compatible Railway API before pushing the
frontend release to the production GitHub branch.

### Single-lap RPM synchronization

The Single Lap Analysis synchronization panel selects an actual session lap
and a video start/end segment. It changes the workspace target lap (not the
reference eligibility policy). `POST /api/v1/xrk/video-sync/rpm` accepts optional
`lap`; with that field it requires an inspection token and filters server RPM
by lap **before** the 5,000-point summary. An absent lap returns 422 rather than
silently searching the full session. Omitting `lap` retains the legacy API.

Selected-lap offsets use the actual session timestamps and only search shifts
with at least 70% of the shorter signal span (and the requested minimum overlap).
This also supports late-session laps outside the old +/-300s window. The result
records selected lap, time ranges, candidate count and search resolution. The
UI uses a 0.1s grid; that is search resolution, not a measured accuracy guarantee.

Video/audio bytes stay in the browser. Audio decoding still reads the whole
file, while STFT/RPM tracking runs only on the chosen segment. One extracted
trace is retained in component memory for reuse with another lap; it is never
uploaded as a video or persisted. Cancellation discards stale results, but
synchronous FFT work and native audio decoding may not stop immediately.
Manual anchors remain authoritative and low-confidence/multiple-engine results
are not auto-applied. Verify a visible shared event before trusting synchronization.
Video gauges use the API's km/h units unchanged and return unavailable outside
the chosen lap's actual time coverage, rather than repeating its endpoint values.

For native channel provenance, private audits and the P0/P1 evidence boundary,
see [XRK Channel Trust](XRK_CHANNEL_TRUST.md). The native Parquet artifact uses
the same fixed inspection expiry; it must not be copied into a public image.
The GPS phase/repeatability prototype and its statistical limits are documented
in [Corner Phases And Repeatability](CORNER_PHASES_AND_REPEATABILITY.md).
The opt-in native-GPS track reference, directed gates, private audit and manual
acceptance steps are documented in [Observed Track Reference](TRACK_REFERENCE.md).
Release the backward-compatible Railway routes before the frontend workspace.
Do not publish private track configs or audit artifacts with the site.

Feedback provenance migration is additive: `narrative_feedback` and
`coach_validations` receive `data_origin`, defaulting existing rows to `unknown`.
Historical clip JSON without an origin remains untouched and excluded. Back up
SQLite before release. Only server-resolved live inspections or server-created
real storyboards enter feedback statistics. Explicit demo submissions return
`DEMO_FEEDBACK_DISABLED`; older unverifiable clients remain quarantined rather
than being promoted retrospectively. `excluded_unverified_count` explains changes
in aggregate totals. This verifies data source, not coach identity, synchronization
accuracy or driving truth. Demo controls must remain disabled even with local video.

```bash
python -m pytest backend/tests -q
pnpm run test:frontend
pnpm run test:coach-debrief
pnpm run test:video-comparison
pnpm run test:guided-review
pnpm run test:dual-driver
pnpm run test:selected-corner
pnpm run test:gnss-sync
pnpm run test:rpm-sync
pnpm run lint
pnpm run build
pnpm run build:vercel
pnpm run test:api-proxy
pnpm run build:api-proxy
docker compose config
python scripts/verify_pilot_deployment.py --require-llm
```

Two-driver guided review adds `/api/v1/comparisons/review` and `/compare`.
Selected-corner coach comparison adds `spatial_profile` to the existing response;
deploy the compatible backend first. Old responses degrade to an unavailable
overlay rather than normalized-distance substitution. See
[Corner Coach Comparison](CORNER_COACH_COMPARISON.md) for unchanged anchor/GPS
boundaries and the section-best versus full-lap-best selection rules.
Deploy the backward-compatible Railway route before publishing that frontend.
See [Dual Driver Review](DUAL_DRIVER_REVIEW.md) for shared-gate timing,
fastest-five variance, independent manual anchors, local repeated-pass search,
and the boundaries of driver-behavior interpretation.

Check CORS with the real frontend domain and confirm cloud mode returns
`local_video_library: false` and `xrk_server_import.available: true` before
exposing the API publicly.

Real Top 3 segment review and GNSS offset diagnostics are additive fields. See
[TOP3_SEGMENT_REVIEW.md](TOP3_SEGMENT_REVIEW.md) for evidence boundaries and private
acceptance commands. Deploy the compatible API before the frontend. A weak GNSS
candidate must remain weak; do not relax limits or overwrite a manual anchor to
make a release check pass.

Failed GNSS speed windows now include additive `speed_check.window_diagnostic`
evidence: unchanged window, common-sample speed residuals before/after its local
best shift, native/summary spacing, GPS position disagreement and camera clock
residual span. The public UI calls the offset spread a **matching disagreement**,
not a measured video delay. Neither regular timestamps nor a high correlation
prove frame accuracy. No failed window is dropped and no threshold, selected
offset or manual-anchor policy changes. See [GNSS_WINDOW_AUDIT.md](GNSS_WINDOW_AUDIT.md)
for private original-packet acceptance. Deploy the additive backend first.

`evidence.segmented_check` adds a read-only per-window timeline. Only held-out
speed windows can be labelled `passed`; fitting windows remain `fit_only`.
`gps_inconsistent` means signal disagreement, not a proven receiver fault or
measured video delay. Missing samples/variation are `insufficient`; unsampled
edges and inter-window gaps are `untested`. The existing 0.25s/0.8 limits and
whole-candidate gate remain unchanged. Additional fixed-offset/gap diagnostics
never promote a result or alter calibration. `whole_recording_verified` is
always false. Manual per-lap anchors continue to drive real Top 3 video review.
The private audit script includes this timeline; compare the previous response
after removing only `segmented_check` to verify legacy candidate compatibility.

Same-file Top 3 review now supports unconfirmed timing candidates from one existing
confirmed lap anchor. Use actual session timestamps, not a repeated lap duration;
never persist a propagated anchor. Learned-landmark checks are browser-local and
cannot promote synchronization. See TOP3_SEGMENT_REVIEW.md for guards. Acceptance
must cover one anchored lap with two unanchored real Top 3 laps, manual correction
priority, disabled candidate voting, and no changes to the saved source anchor.
This frontend-only change does not require a Railway API deployment.

### Start-only review boundaries

Short Top 3/zone comparisons derive one start distance from the reference lap,
then interpolate each real lap's timestamp at that distance. Both clips run for
exactly five seconds; missing coverage is not padded, shifted or shortened.
Full-context playback and legacy manual ranges remain available.

The default manual editor requires only a start and explicit lap/location
confirmation. The end is start +5s. A local, clip-specific revision retains the
original source anchor, proposed start and human picking uncertainty (+/-0.5s).
This is not a statistical confidence interval, a clock correction or a relaxed
acceptance limit. Global lap anchors and their history are never overwritten.
Advanced custom ranges remain optional; old saved crops are not migrated.

Boundary review decodes two reference frames and at most 27 target frames
locally. Two background regions reuse the 0.72 similarity / 0.06 ambiguity
rules, with a 0.25s inter-region candidate agreement check. Results only offer
frames to inspect. They cannot save calibration, confirm feedback, or clear a
GPS failure. The five-second endpoint is advisory because real speed differences
can produce different end positions. Cancellation disposes the hidden decoder.

GPS checks retain a small same-file, same-session diagnostic timeline locally.
The clip maps those telemetry intervals using its current manual/candidate offset,
not the rejected GNSS proposal. GPS disagreement remains visible with a +/-0.5s
boundary margin. Missing diagnostics, fit-only and untested intervals are not
passes. Run GPS timing again for files whose older diagnostics were not retained.

Acceptance: replay the private one-anchor/two-candidate flow, confirm only the
start, check five-second stopping, unchanged global anchors, local restoration,
ambiguous image results, GPS warning overlap, bilingual/mobile layout, and no
video/feedback uploads. Real video, screenshots and audit output stay in ignored
`tmp/`; only reusable scripts and mock tests are committed.

## Production API routing

The primary public deployment uses a Vercel external rewrite directly to the
Railway API:

```text
Small API calls: Browser -> same-origin Vercel /api/v1 -> Railway FastAPI
XRK upload:      Browser -> Railway /api/v1/xrk/inspect
```

The Next.js `/api/runtime-config` route returns the current Vercel origin for
ordinary API calls and a dedicated `xrkUploadUrl` for the large multipart
request. XRK bypasses Vercel's external rewrite because a browser multipart
request without a declared content length previously reached a proxy with a
zero-byte body. Keep Railway CORS configured for the public Vercel and Sites
origins. `XRK_UPLOAD_URL` may override the direct Railway inspection endpoint
without changing the client bundle.

`vercel.json`, `app/api/runtime-config/route.ts`, Vercel `API_URL`, and
`XRK_UPLOAD_URL` must refer to the same Railway service. Verify runtime config
after every frontend release; production must never contain a localhost origin.

## Optional Cloudflare API proxy

The Worker in `cloudflare/api-proxy` is retained as an optional fallback and is
not part of the primary Vercel production path:

```text
Browser -> Cloudflare Worker -> Railway FastAPI
```

It accepts only `/api/v1/*`, checks the browser origin, streams XRK/XRZ request
bodies without buffering them, and preserves FastAPI status codes and response
bodies. Python, OpenCV, PyArrow, and `libxrk` remain on Railway; the Worker is
not an XRK parser or file store.

Deploy it from the repository root:

```bash
pnpm exec wrangler whoami
pnpm run test:api-proxy
pnpm run build:api-proxy
pnpm exec wrangler deploy --config cloudflare/api-proxy/wrangler.jsonc
```

Only configure Vercel to use this fallback when specifically testing the Worker:

```text
NEXT_PUBLIC_API_URL=https://racing-telemetry-api-proxy.<account>.workers.dev
API_URL=https://racing-telemetry-api-proxy.<account>.workers.dev
NEXT_PUBLIC_API_PREFIX=/api/v1
```

Sites follows the same browser contract. Its Worker returns the Sites origin
from `/api/runtime-config` and streams `/api/v1/*` to the Railway `API_URL`.
Do not change runtime configuration back to an untrusted or non-HTTPS origin;
that reintroduces DNS, privacy-extension, and CORS failure modes.

Keep `UPSTREAM_ORIGIN` and `ALLOWED_ORIGINS` in `wrangler.jsonc` limited to the
actual Railway API and approved frontend origins. The optional
`ALLOWED_ORIGIN_HOST_PATTERNS` is hostname-only and currently admits this
project's HTTPS Vercel Preview domains; do not replace it with a broad
`*.vercel.app` pattern. Cloudflare's request body
limit and the backend's `MAX_XRK_UPLOAD_BYTES` must both accommodate the chosen
XRK limit. The current proxy rejects declared request bodies above 50 MB, and
FastAPI remains responsible for validating chunked uploads.

### XRK upload transport troubleshooting

The browser now sends a standard multipart `file` field made from a detached
in-memory Blob. It must NOT set `Content-Type` or a multipart boundary manually,
and must NOT attach `X-XRK-Filename` on this path. This avoids depending on a
custom-header preflight while preserving bytes after Safari file-picker cleanup.
The legacy octet-stream endpoint remains supported. CORS origins, TLS validation,
file size limits and server-side signature validation are unchanged.

Capability/health success does not prove a file can be uploaded. Verify a
multipart upload separately and distinguish transport/signature rejection from
successful native parsing. Rejected OPTIONS requests now log
`cors_preflight_rejected`, request ID, origin, requested method and header NAMES
(not authorization values or file contents). Do not add `*` to fix a rejection.

Primary public navigation is `/workspace` (telemetry), `/video-coach` (local
video), `/methods` (methods and capability status), and `/about` (project and
workflows). Navigation labels are bilingual; content follows the saved locale.
Run `node --test tests/rendered-html.test.mjs` after a Sites build to check routes.

When the UI reports an XRK transport error, verify the chain in this order:

```text
GET  <worker>/api/v1/health
GET  <worker>/api/v1/capabilities
POST <worker>/api/v1/xrk/inspect
```

- `XRK_FILE_TOO_LARGE`: the browser blocked a file above the capability's
  advertised limit before sending it. Align Worker and Railway limits rather
  than hiding the error.
- `XRK_FILE_READ_FAILED`: the browser could not retain/read the selected local
  file. Re-select it and confirm it has not moved.
- `XRK_UPLOAD_TRANSPORT_FAILED`: the file was readable but the browser did not
  receive an HTTP response. First confirm `/api/runtime-config` returns the
  current frontend origin, then check the same-origin `/api/v1/health` path and
  its edge rewrite/upstream. Direct browser access to `workers.dev` should not
  be required in production.
- `PROXY_UPSTREAM_UNAVAILABLE`: the Worker answered but could not reach Railway;
  inspect Worker logs and Railway health before changing the frontend.

After changing `wrangler.jsonc`, run the proxy tests and deploy the Worker. A
Vercel redeploy is needed only when `NEXT_PUBLIC_API_URL` or another build-time
frontend variable changes.

## Coach review clips and selection feedback

The XRK workspace's **AI Coach Summary** now contains real Top 3 sector
comparisons, cumulative time deltas, and up to three rule-selected corner
reviews. Candidates compare the target against one real eligible Top 3 lap
over the complete corner plus downstream interval. They are not synthesized
laps, verified driving diagnoses, or guaranteed gains. Lap Quality Gate,
consensus and LLM generation rules are unchanged.

Confirm video synchronization for the selected lap in **Single Lap Analysis**,
then return to **AI Coach Summary**. The default preview is four seconds;
the full-context toggle uses actual corner/downstream crossing times. Both
clip bounds must fall within available lap/video timing. Missing edge samples
are not extrapolated. Each reference lap needs its own matching calibration;
without it the real telemetry comparison remains but no reference video is
invented. The left reference and right target each offer **Add / Adjust clip**,
including independent local files, start/end marks, seek/micro-adjustment, and
preview. Explicit reference selection remains quality-gated; target changes use
the existing analysis endpoint. Pair playback starts each clip together; it does
not claim frame-by-frame distance locking or stretch either video's timeline.

A manual crop alone never establishes synchronization. A matching actual-lap
anchor and explicit human confirmation are required before telemetry values or
the shared cursor are enabled; the complete crop must remain in continuous
telemetry coverage. Unconfirmed clips remain preview-only. Crop durations do
not replace the displayed common-track-interval time deltas. Independent files
and their corrections remain bound to each side's lap, with at most ten metadata
revisions retained locally. After refresh, reselect the same local video; no
video bytes or filenames are stored in the revision history. A single anchor
does not estimate clock drift. **Restore automatic clip** retains both sources.

After playing each clip, select Accurate / Partly accurate / Inaccurate /
Cannot judge and optionally specify timing, corner, relevance, or synchronization
issues. The form confirms success only after server acknowledgement and keeps
failed submissions available for retry. Changing a lap, calibration or clip
range creates a different feedback identity. The same receipt can be revised
without creating duplicate votes.

- `POST /api/v1/feedback/clip-selection`: strict bounded feedback schema; no
  filename, video bytes or raw telemetry accepted.
- `GET /api/v1/feedback/clip-selection/stats`: grouped verdict/locale/reason/source/side
  counts only; no individual session identifiers or clip timings returned.
- SQLite creates `clip_selection_feedback` additively at startup on the
  existing Railway persistent volume. Deploy the backend before the frontend.
- Feedback records selection accuracy, not confirmed driving behavior; it
  never automatically trains a model or changes analysis rules.
- Manual correction feedback uses a separate receipt and question, with original
  clip linkage and optional anchor times/distance. A receipt cannot change source
  or side. Unconfirmed manual previews accept only `uncertain`. Corrected clips
  never count as successful automatic selections; legacy clients stay compatible.
- Video remains in browser memory. Calibration/receipt state is local to the
  browser, and the normalized XRK session retains its existing expiry.

Local release verification uses private XRK/video files only locally. A test
anchor exercises playback and feedback but is **not** evidence that those
files depict the same lap. Public smoke tests use the reviewed public demo.
See `docs/COACH_REVIEW_FEEDBACK.md` for the user workflow and limits.

## Layered coach debrief and local landmarks

`/api/v1/xrk/analyze` now adds `coach_debrief` and `narrative_status`; existing
analysis fields and quality/consensus rules are unchanged. The three tiers are
observations, review questions, and separately validated training. An empty
training tier does not discard real sector/event comparisons. Inferred RPM
reduction is never renamed as confirmed braking. Relative event differences
are calculated by the existing backend and expressed as earlier/later than a
real reference, not as absolute track coordinates or prescribed braking moves.

The optional LLM receives compact summary evidence, selects existing evidence
IDs within each tier, and adds number-free commentary. The server inserts the
original fact text/numbers. Unknown IDs, tier promotion, invented numbers and
prohibited driver-input claims fall back to structured facts. `narrative_status`
distinguishes configuration, timeout, provider, format and policy failures with
bounded reason codes, never keys or upstream error bodies. The request locale is
forwarded to generation; capability availability is not generation success.

In each AI Coach review video, open **Trackside landmarks / 赛道边参照物**:

1. Pause a clear frame, select **Mark current frame**, drag a rectangle around a
   fixed roadside feature, and name it (optional English name).
2. Confirm the lap/corner and that the feature is stationary. A separate passing
   checkbox requires manually confirmed video synchronization and continuous
   telemetry coverage. Merely visible landmarks never provide passing distances.
3. In the other lap's clip choose the saved landmark and **Find in this clip**.
   A bounded normalized-correlation template search proposes a frame. Weak and
   ambiguous matches remain unconfirmed. Check the actual frame before saving.
4. Only confirmed passing sightings can label observed RPM reduction/recovery
   relative to a landmark. They cannot alter synchronization or produce a new
   braking/throttle recommendation. Delete a landmark to remove its local data.

This is an experimental same-view template library, not a trained semantic
vision model. It scans at most 12 seconds / 25 frames around the current clip
position. It will miss viewpoint, occlusion and appearance changes; manual
selection remains available. Similarity is not calibrated accuracy. The method
follows the normalized coefficient approach described in the
[OpenCV template-matching reference](https://docs.opencv.org/4.x/de/da9/tutorial_template_matching.html).
There is no video upload, LLM image request or new vision dependency.

Up to 12 cropped thumbnails/templates and 20 confirmed sightings per landmark
stay in browser localStorage, scoped to session fingerprint and zone geometry.
File/video identity, lap and calibration must match before a sighting is used.
Changing synchronization invalidates its old distance association. No automatic
cross-session/cross-camera generalization, offline model training, official
corner naming or brake-point accuracy is claimed. Coach video feedback still
does not automatically train a model. Public demo cannot save landmarks.

Local acceptance: `pnpm run test:coach-debrief`, backend pytest and normal
release checks above. Private video/XRK evidence must not be committed or
uploaded for smoke tests. Deploy the additive backend response before the
frontend; older backend/demo responses show an explicit fallback.

## Local two-driver video comparison

The `/video-coach` entry now defaults to two local videos, manual same-location
starts and five-second paired playback. The prior single-lap experiment remains
in a separate tab. See [Driver Video Comparison](DRIVER_VIDEO_COMPARISON.md).
This frontend-only addition reuses the existing landmark and boundary algorithms;
no Railway deployment or video upload is required. Run the new comparison tests
and desktop/mobile browser acceptance before publishing Vercel and Sites.

## Guided review and free workspace

The homepage and top navigation expose `/review` for the six-step guided flow.
`/workspace` stays the original free workspace; existing bookmarks are not
redirected. Both reuse the same inspection, analysis and local video components.
No backend migration, new analysis rule or video upload is required for this
frontend release. See [Guided Review](GUIDED_REVIEW_PREVIEW.md) for scope and limits.
After deployment check both routes, desktop/mobile navigation, runtime config,
and the reviewed public demo. Private XRK/video acceptance remains local only.

## Provider references

- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Railway configuration as code](https://docs.railway.com/config-as-code/reference)
- [Railway volumes](https://docs.railway.com/volumes)
- [Railway health checks](https://docs.railway.com/deployments/healthchecks)
- [libxrk wheels](https://pypi.org/project/libxrk/)
- [FastAPI container deployment](https://fastapi.tiangolo.com/deployment/docker/)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
