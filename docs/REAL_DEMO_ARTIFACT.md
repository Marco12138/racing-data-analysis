# Real Demo Artifact

The public `Try Demo` flow can optionally load a precomputed, anonymized real
XRK analysis through `NEXT_PUBLIC_REAL_DEMO_ASSET_URL`. When the variable is
empty, unavailable, or invalid, the existing CSV demo remains unchanged.

No XRK/XRZ file belongs in the repository. A publishable JSON artifact must be
generated from the backend's normalized analysis response and pass all of these
gates before hosting:

- publication permission is confirmed;
- driver, vehicle, circuit, date, filenames, fingerprints and free text are
  reviewed for private identifiers;
- telemetry values are measured values or calculations produced by the backend,
  never hand-authored or synthesized for presentation;
- at least three real laps pass the Lap Quality Gate;
- Track Map, distance-aligned telemetry, Top-3 consensus, sectors and zones are
  present;
- both `synthetic_curve_generated` fields are `false`;
- optional `narrative` is retained only if it was generated from the same
  reviewed evidence payload.

Required envelope:

```json
{
  "schema_version": 1,
  "provenance": {
    "dataset_kind": "anonymized_real_session",
    "derived_from_real_session": true,
    "publication_permission": "confirmed",
    "telemetry_values": "measured_or_backend_calculated_only"
  },
  "privacy_review": {
    "status": "passed",
    "private_identifiers_removed": true,
    "free_text_reviewed": true
  },
  "display": {
    "driver": "Anonymous Driver",
    "vehicle": "Anonymous Kart",
    "track": "Anonymous Circuit",
    "date": "Private"
  },
  "analysis": "<complete /api/v1/xrk/analyze response>"
}
```

Host the reviewed JSON as a static same-origin asset and set its public path in
the frontend build environment. The UI treats it as read-only because its
temporary XRK inspection token is not published. As a second privacy boundary,
the browser loader replaces session metadata, inspection ID, file fingerprint
and track ID with anonymous public values before rendering.

## Current blocker

The repository contains only hand-authored CSV demo values and generated test
fixtures. A complete normalized real session exists only in ignored local
storage and includes private source identifiers. There is no publication
permission record or completed privacy review for that session, so it must not
be repackaged as the public demo yet.
