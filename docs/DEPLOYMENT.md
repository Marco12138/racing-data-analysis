# Deployment Guide

## Stage 1 public demo

The current public demo only needs:

- Frontend: Vercel, built with `pnpm run build:vercel`.
- API: Railway or Render using the root `Dockerfile`.

CSV analysis and video first-frame preview run in the browser. AiM XRK/XRZ
files are sent to the FastAPI container for temporary parsing, so the hosted
frontend remains usable even before a public API domain is configured. The API
is required only for XRK/XRZ import, the optional server-side CSV endpoint, and
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
```

This cloud-mode container is suitable for publishing the frontend and CSV
analysis API. XRK/XRZ files are parsed in an isolated subprocess and deleted
with their temporary directory after every request. Cloud mode deliberately
disables local video discovery and is **not a multi-user video service**.

Railway sends deployment health checks with `healthcheck.railway.app` as the
Host header. Keep that hostname in `ALLOWED_HOSTS` so Trusted Host validation
accepts the platform health check.

Use these health checks:

```text
GET /api/v1/health
GET /api/v1/system/health/live
GET /api/v1/system/health/ready
```

`GET /api/v1/health` has the stable response:

```json
{"status":"ok"}
```

## Future commercial launch gate

Do not enable public video uploads until all of the following are implemented:

1. Replace `utils/storage.py` with PostgreSQL repositories and migrations.
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
docker compose config
```

Check CORS with the real frontend domain and confirm cloud mode returns
`local_video_library: false` before exposing the API publicly.

## Provider references

- [Vercel environment variables](https://vercel.com/docs/environment-variables)
- [Railway FastAPI deployment](https://docs.railway.com/guides/fastapi)
- [FastAPI container deployment](https://fastapi.tiangolo.com/deployment/docker/)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
