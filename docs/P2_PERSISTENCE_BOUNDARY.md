# P2 Persistence Boundary

## Scope of this slice

This change adds an ownership boundary to the metadata that the current Demo
already stores. It does not enable accounts or change the temporary XRK cache.

- `ActorContext` is the single value passed from a future authentication
  dependency into persistence operations.
- Existing `sessions`, `video_jobs`, and `video_markers` rows receive the owner
  `anonymous-public-demo` through an additive SQLite migration.
- Reads, updates, marker creation, and deletion are scoped by `owner_id`.
- Existing API calls omit an actor and therefore retain exactly the current
  anonymous behavior.
- `GET /api/v1/capabilities` reports this boundary honestly as owner-scoped but
  not multi-user ready.

The SQLite migration runs idempotently during normal application startup. It
does not delete or rewrite existing records.

## Stable application contract

Repository-facing code must receive an `ActorContext`; it must not accept an
owner ID from request JSON, a filename, or an object key. When authentication
is introduced, a verified JWT/OIDC dependency will create the context from the
validated identity subject.

The current default remains:

```text
ActorContext(owner_id="anonymous-public-demo", authenticated=false)
```

Future authenticated requests will use a server-derived value such as:

```text
ActorContext(owner_id="user:<verified-subject>", authenticated=true)
```

Client-provided identifiers must never be trusted as ownership proof.

## Deployment profiles

No new service or environment variable is required for the public Demo:

```text
DATABASE_URL=sqlite:////app/storage/sessions.sqlite3
STORAGE_BACKEND=local
TASK_QUEUE_BACKEND=inline
WEB_CONCURRENCY=1
```

These future values remain documentation only until their adapters and
migrations are implemented and tested:

```text
DATABASE_URL=postgresql+psycopg://<managed-connection>
STORAGE_BACKEND=s3
OBJECT_STORAGE_BUCKET=<private-bucket>
OBJECT_STORAGE_ENDPOINT=<s3-compatible-endpoint>
TASK_QUEUE_BACKEND=redis
REDIS_URL=rediss://<managed-redis>
```

Do not set those future values on the current service. The application fails
closed instead of silently pretending that managed persistence is active.

## Remaining commercial launch work

This PR establishes only the identity-to-metadata ownership contract. It does
not complete the five commercial launch gates:

1. Replace module-level SQLite operations with PostgreSQL repositories and
   versioned migrations; backfill `owner_id` from verified account mapping.
2. Add private S3/R2 assets, server-generated owner-prefixed object keys,
   multipart upload completion, checksums, retention, and signed downloads.
3. Add a Redis dispatcher and separately deployed idempotent analysis worker;
   enqueue job IDs only, never local paths or raw credentials.
4. Validate OIDC/JWT issuer, audience, expiry, and subject, then inject an
   authenticated `ActorContext` into every protected route.
5. Add transactional quotas, rate limits, deletion workflows, audit events,
   malware/container checks, and operational monitoring.

Until all five are complete, keep `authentication`, `direct_uploads`,
`persistent_object_storage`, `durable_task_queue`, and
`persistence.multi_user_ready` false in the public capability response.
