# Deployment Guide

## Stage 1 public demo

The current public demo only needs:

- Frontend: Vercel, built with `pnpm run build:vercel`.
- API: Railway or Render using the root `Dockerfile`.

CSV analysis and video first-frame preview run in the browser. AiM XRK/XRZ
files are sent to the FastAPI container for temporary parsing. The API is
required for XRK/XRZ import, the optional server-side CSV endpoint, and
health/capability checks. PostgreSQL, Redis, authentication, and object storage
are intentionally not required in this phase.

Railway or Render is the simplest first backend host because OpenCV and FFmpeg
need a normal container and analysis tasks may outlive serverless request limits.
Cloud Run is a good later option when job volume and operational requirements grow.

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
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_API_PREFIX=/api/v1
NEXT_PUBLIC_DEPLOYMENT_MODE=public-demo
```

These values are embedded in browser assets at build time. Redeploy after they change.

## Sites frontend

Set these Worker runtime values in Sites:

```text
API_URL=https://api.example.com
API_PREFIX=/api/v1
DEPLOYMENT_MODE=public-demo
```

The Worker exposes only these public values through same-origin
`GET /api/runtime-config`. The browser uses that response for XRK inspection,
analysis, deletion, and capability requests. HTTPS pages reject loopback or
non-HTTPS API origins. `pnpm run build` scans client assets and fails when a
literal `http://127.0.0.1:8000` or `http://localhost:8000` is present.

## FastAPI container

Deploy the root `Dockerfile`. For the current public Demo adapter:

```text
APP_ENV=production
APP_MODE=cloud
API_HOST=0.0.0.0
API_PORT=8000
DOCS_ENABLED=false
CORS_ORIGINS=https://www.example.com
ALLOWED_HOSTS=api.example.com,healthcheck.railway.app
DATABASE_URL=sqlite:////app/storage/sessions.sqlite3
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

1. **Railway Dashboard** → 后端服务 `racing-ai-platform-api` → **Variables**，
   添加 `LLM_BASE_URL`（deepseek 用 `https://api.deepseek.com/v1`）、
   `LLM_API_KEY`、`LLM_MODEL=deepseek-chat`，然后重新 **Deploy**。
2. 验证连通性（本地，脚本只从环境变量读 key，不写盘不打日志）：
   ```bash
   LLM_BASE_URL=... LLM_API_KEY=... LLM_MODEL=deepseek-chat \
     python scripts/verify_llm_config.py
   ```
   也可以只设置变量后在 Railway 后端环境里执行同一命令。
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

Railway sends deployment health checks with `healthcheck.railway.app` as the
Host header. Keep that hostname in `ALLOWED_HOSTS` so Trusted Host validation
accepts the platform health check.

Use these health checks:

```text
GET /api/v1/health
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

```bash
python -m pytest backend/tests -q
pnpm run lint
pnpm run build
pnpm run build:vercel
pnpm run test:api-proxy
pnpm run build:api-proxy
docker compose config
```

Check CORS with the real frontend domain and confirm cloud mode returns
`local_video_library: false` and `xrk_server_import.available: true` before
exposing the API publicly.

## Cloudflare API proxy

The optional Worker in `cloudflare/api-proxy` provides a fixed-origin streaming
proxy between the public frontend and FastAPI:

```text
Vercel -> Cloudflare Worker -> Railway FastAPI
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

Set the Vercel Production and Preview variables to the resulting Worker origin:

```text
NEXT_PUBLIC_API_URL=https://racing-telemetry-api-proxy.<account>.workers.dev
API_URL=https://racing-telemetry-api-proxy.<account>.workers.dev
NEXT_PUBLIC_API_PREFIX=/api/v1
```

Keep `UPSTREAM_ORIGIN` and `ALLOWED_ORIGINS` in `wrangler.jsonc` limited to the
actual Railway service and approved frontend origins. The optional
`ALLOWED_ORIGIN_HOST_PATTERNS` is hostname-only and currently admits this
project's HTTPS Vercel Preview domains; do not replace it with a broad
`*.vercel.app` pattern. Cloudflare's request body
limit and the backend's `MAX_XRK_UPLOAD_BYTES` must both accommodate the chosen
XRK limit. The current proxy rejects declared request bodies above 50 MB, and
FastAPI remains responsible for validating chunked uploads.

### XRK upload transport troubleshooting

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
  receive an HTTP response. Check that the Worker is deployed, its exact/pattern
  origin allowlist includes the active frontend domain, and its Railway upstream
  is current.
- `PROXY_UPSTREAM_UNAVAILABLE`: the Worker answered but could not reach Railway;
  inspect Worker logs and Railway health before changing the frontend.

After changing `wrangler.jsonc`, run the proxy tests and deploy the Worker. A
Vercel redeploy is needed only when `NEXT_PUBLIC_API_URL` or another build-time
frontend variable changes.

## Provider references

- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Railway FastAPI deployment](https://docs.railway.com/guides/fastapi)
- [FastAPI container deployment](https://fastapi.tiangolo.com/deployment/docker/)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
