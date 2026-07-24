# Production Architecture

## Current boundaries

The repository intentionally keeps two deployment modes:

| Area | Local MVP | Public production target |
| --- | --- | --- |
| Frontend | Next/vinext on localhost | Next.js on Vercel |
| API | One FastAPI process | Containerized FastAPI service |
| Metadata | SQLite | Managed PostgreSQL |
| Video bytes | Local filesystem cache | S3-compatible object storage |
| Analysis tasks | FastAPI background task | Redis-backed worker queue |
| Identity | Anonymous local user | OIDC/JWT identity provider |

`APP_MODE=local` preserves the existing filesystem video library. `APP_MODE=cloud`
disables those routes so a public server cannot accidentally scan its host
filesystem. Cloud mode reports upload/auth/queue capabilities and the native
XRK parser probe through `GET /api/v1/capabilities`;
`GET /api/v1/system/capabilities` remains a compatibility alias.

## Deployable modules

- `app/` and `frontend/`: presentation and browser-side CSV analysis. The API
  origin and prefix are build-time environment variables.
- `backend/app/api/`: versioned HTTP boundary. Legacy `/api/...` paths remain
  available for the MVP, while new integrations use `/api/v1/...`.
- `backend/app/analysis/`: pure analysis logic. It should remain independent
  from authentication, storage vendors, and queue implementations.
- `backend/app/core/`: settings and infrastructure extension points.
- `backend/app/utils/storage.py`: current SQLite adapter. This is the one module
  to replace with repositories when PostgreSQL is introduced.
- `backend/app/core/task_dispatcher.py`: current inline adapter and the seam for
  Celery, Dramatiq, RQ, or ARQ.

## Multi-user evolution

Before user registration is enabled, introduce these durable entities:

- `users`: external identity subject, email, display name, status.
- `sessions`: owner ID, track, driver, timestamps, analysis state.
- `assets`: owner ID, object key, checksum, media type, byte size.
- `analysis_jobs`: owner ID, asset ID, status, progress, error, worker version.
- `markers`: owner ID or session ID plus the existing marker fields.

Every repository method must receive an authenticated actor or tenant ID.
Object keys should be server-generated and namespaced by owner. API clients
must never supply arbitrary filesystem paths or object-store keys.

## Upload and worker flow

1. Authenticated browser requests a multipart upload session.
2. FastAPI validates quota and returns short-lived signed object-storage URLs.
3. Browser uploads directly to S3/R2; Vercel and FastAPI do not proxy multi-GB files.
4. Browser completes the upload and creates an analysis job.
5. FastAPI writes a PostgreSQL job record and enqueues only its job ID.
6. A worker downloads or streams the object, runs OpenCV, uploads keyframes, and
   updates progress idempotently.
7. The frontend polls or subscribes to job status.

Suggested future endpoints:

```text
POST /api/v1/uploads
POST /api/v1/uploads/{upload_id}/complete
POST /api/v1/video/jobs
GET  /api/v1/video/jobs/{job_id}
GET  /api/v1/video/jobs/{job_id}/assets
```

The current local source-ID endpoint remains a local-only compatibility path.

## Security and operations gates

- Validate JWT issuer, audience, expiry, and subject in FastAPI.
- Scope every job, marker, session, and asset query by owner.
- Use signed URLs with short expiry for private video/keyframe access.
- Add per-user quotas, rate limiting, malware/container inspection, and upload
  checksum validation before enabling public uploads.
- Run OpenCV tasks outside web processes with CPU/memory/time limits.
- Export structured logs, request IDs, job IDs, error tracking, and metrics.
- Use database migrations and backups; do not mount SQLite for multiple replicas.
