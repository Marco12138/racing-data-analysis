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

## Upload body follow-up

Some browser and proxy combinations later delivered the multipart request with
an empty file body even though capability checks were healthy. Public XRK
uploads now use a bounded `application/octet-stream` body and carry only the
URL-encoded basename in `X-XRK-Filename`. FastAPI accepts both this transport
and the legacy multipart contract, applies the same size/signature checks, and
deletes the original upload after parsing.

The browser reads the selected file before opening the network request. Files
that are only iCloud or network-drive placeholders must be downloaded locally
first. Local development also offers an optional whitelisted XRK library, but
those filesystem routes return unavailable in `APP_MODE=cloud`; the public
service never discovers or reads a visitor's local directories.

## Release verification

Deploy the backend first, then verify health, capabilities, CORS, legacy import,
raw-body CORS preflight, and one private XRK inspection. Deploy the exact
validated frontend version and complete an upload, inspection, analysis, and
explicit token deletion in the public browser.
