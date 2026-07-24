# XRK Public Import Incident

## Root cause

The public browser bundle contained `http://127.0.0.1:8000` as its API origin.
Sites had a `NEXT_PUBLIC_API_URL` runtime value, but Next/vinext had already
compiled the browser code. Public uploads therefore targeted the visitor's own
computer and were blocked by the browser before reaching Railway.

The Railway route and Linux parser were healthy. A direct production request
to `/api/v1/xrk/inspect` parsed the private Wuhan sample successfully with
`libxrk==0.12.0`; this was not a Windows DLL, MIME, request-size, reverse proxy,
or native-library failure.

## Repair

- Sites now serves a same-origin `/api/runtime-config` response from Worker
  runtime values.
- XRK and capability clients resolve the API asynchronously and reject
  loopback or insecure origins on a public HTTPS page.
- The backend capability response performs a real native parser probe.
- Public XRK errors use stable codes and request IDs.
- Inspection lifecycle logs are structured and contain no telemetry,
  metadata, file contents, or temporary filesystem paths.
- Production client builds fail when they contain a literal loopback API URL.

## Release verification

Deploy the backend first, then verify health, capabilities, CORS, legacy import,
and one private XRK inspection. Set the Sites `API_URL` runtime value, deploy
the exact validated frontend version, and complete an upload, inspection,
analysis, and explicit token deletion in the public browser.
