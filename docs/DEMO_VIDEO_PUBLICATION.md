# Reviewed Video Demo

The October 2026 demo replaces the earlier telemetry-only publication with one
anonymous, real session and nine approved five-second onboard excerpts.
The user explicitly requested publication of this paired analysis. Original XRK
files, the complete recording, absolute GPS coordinates, driver identity, dates
and raw container telemetry are not included in the public assets. The approved
five-second excerpts retain their original audio. Sanitized, clip-relative GPS5
2D speeds are published separately in `public/demo/video/media.json`.

## Evidence and Limits

- Logger fastest lap: L5, 41.055 s. Top-three valid laps: L5, L4, L6.
- Virtual sector winners: L5, L4, L6 respectively. These are real completed laps,
  not a composite driving target or a causal improvement estimate.
- Video timing retains the user's L4 start at 159.55 s with +/-0.5 s uncertainty.
  Other laps are extrapolated using recorded session time. No saved user anchor
  is modified by opening the demo.
- Each sector uses the same reference-distance start for its three clips, then
  five seconds of real video. The end positions need not match. Paired playback
  uses elapsed clip time, not distance warping or frame-accurate synchronization.
- The L6/Sector 1 excerpt overlaps the GPS-inconsistent interval and retains its
  warning. No clip is relabelled as automatically confirmed.
- No transferable training priorities passed for this sample. The demo shows
  observations and video comparisons, without fabricating coaching conclusions.
- Demo feedback and coach votes remain disabled.

## Rebuilding

`scripts/publish_reviewed_video_demo.py` is a local publication tool, not a web
upload endpoint. Supply a current analysis JSON, segmented GNSS audit JSON,
private source video, ffmpeg path, explicit anchor and publication approval:

```bash
python scripts/publish_reviewed_video_demo.py \
  --analysis /private/path/analysis.json --gps /private/path/gnss.json \
  --video /private/path/video.mp4 --ffmpeg /path/to/ffmpeg \
  --anchor-lap 4 --anchor-start 159.55 --approved-for-publication
python scripts/generate_demo_session_resource.py
```

To restore audio and GPS speed on the existing approved excerpts, without
changing their timing or anchors:

```bash
node --experimental-strip-types scripts/refresh_demo_media.mjs \
  --video /private/path/original.mp4 --ffmpeg /path/to/ffmpeg \
  --approved-for-publication
python scripts/generate_demo_session_resource.py
```

Inspect start/middle/end frames and listen to the excerpts for private speech.
Check for identifiable people/text and confirm each file contains only a
five-second H.264 video stream plus AAC audio. No GPMF, UTC or location track is
remuxed. The speed manifest contains only relative time, speed and GPS fix, bound
to the exact approved URL/start/duration. It works with older cached backend
summaries; a content revision bypasses old silent video caches. The player reads
speed on presented frames/seeks using the existing 0.25-second maximum-gap rule.
Within-packet timing remains estimated and sensor-to-frame latency uncalibrated.
This overlay is not an independent confirmation of AiM/video synchronization.
Only one player emits sound at a time; users can switch audio or mute both.
Run release checks after rebuilding.
Only `public/demo/video/` is allowed through the Vercel MP4 exclusion. The backend
serves the compact summary; static excerpts are served by each frontend origin.
Deploy the backend resource before the frontends and verify both `/demo` and
`/workspace?demo=1`.

The previous anonymous publication is retained only as a reduced backend test
fixture for storyboard cases that require transferable evidence. It is not
displayed as the current demo, and its evidence is not copied into this session.

## Session Display Labels

Edits to Driver, Vehicle, Track and Date now persist per temporary inspection in
browser storage and update the session selectors immediately. Restoring an active
inspection merges these display labels with the refreshed server response.
Recorder metadata and server analysis identity remain unchanged; this is not a
server-side driver identity correction. The existing fixed token expiry remains.
