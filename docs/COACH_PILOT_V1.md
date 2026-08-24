# Coach Pilot v1

## Purpose

Coach Pilot v1 is an invite-only evaluation with a small group of drivers and
coaches. It validates whether the existing evidence-bounded analysis is useful
in real training. It is not a multi-user commercial launch.

The production baseline is:

- Vercel frontend;
- one Railway FastAPI worker;
- one Railway Volume mounted at `/data` for SQLite metadata;
- temporary XRK inspection artifacts with a fixed 30-minute expiry;
- browser-local video handling;
- optional DeepSeek narrative with structured-report fallback.

## Allowed pilot workflow

1. A participant uploads CSV or AiM XRK/XRZ data.
2. The quality gate selects only valid completed laps.
3. Analysis compares real laps by distance and reports measured, calculated,
   and inferred evidence separately.
4. The participant and coach review the report together and submit feedback.
5. The team records parser failures and incorrect or unhelpful conclusions.

Do not describe virtual sectors as official timing points, and do not present
inferred lifting or likely braking as a direct sensor measurement. The pilot
must not reintroduce theoretical-best laps or synthetic telemetry curves.

## Launch gates

### Deployment

- [ ] Railway Volume is attached at `/data`.
- [ ] `DATABASE_PATH=/data/racing.sqlite` and `WEB_CONCURRENCY=1` are active.
- [ ] Railway health check uses `/api/v1/system/health/ready`.
- [ ] Vercel runtime config and direct XRK upload target the same Railway API.
- [ ] A feedback write remains available after a Railway restart or redeploy.
- [ ] `python scripts/verify_pilot_deployment.py` passes against production.

### Real-data validation

- [ ] At least 20 private XRK/XRZ files cover multiple logger versions,
  channel sets, tracks, and session lengths.
- [ ] Parser success and failure reasons are recorded without retaining raw
  user files beyond processing.
- [ ] GPS cleaning and lap-quality thresholds are reviewed against labelled
  real sessions; passing one demo file is not treated as calibration.
- [ ] Missing GPS, RPM, brake, throttle, gear, or sector channels degrade
  explicitly without fabricated replacements.

### Coaching review

- [ ] At least 10 real sessions are reviewed by a driver and a coach.
- [ ] Every displayed number can be traced to measured or calculated evidence.
- [ ] LLM and structured summaries are compared for specificity, accuracy,
  language, actionability, and safety.
- [ ] Incorrect inference, vague advice, and unsupported certainty are logged.
- [ ] LLM remains optional until the reviewed evidence supports enabling it.

### Operations and privacy

- [ ] Pilot participants receive a short notice covering temporary XRK
  processing, metadata retention, local video handling, and deletion requests.
- [ ] The team has an owner for deployment alerts and participant support.
- [ ] Request IDs, parser errors, upload failures, and analysis duration can be
  inspected without exposing telemetry values or API keys.
- [ ] A SQLite backup and restore smoke test has been completed from the
  Railway Volume.
- [ ] File-size, rate-limit, timeout, and expected short deployment downtime
  are communicated to participants.

## Exit criteria

Coach Pilot v1 is successful when the gates above are complete and coach review
shows that the product reliably identifies useful review points without
inventing measurements. The next phase may then add authenticated ownership,
PostgreSQL, object storage, and a durable task queue.

Until then, keep the cohort small, do not promise permanent session storage,
and do not market the system as a replacement for a human coach.
